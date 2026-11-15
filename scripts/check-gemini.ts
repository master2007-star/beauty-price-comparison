/**
 * Fixture-based verification for the Gemini helpers: response-text
 * extraction, JSON parsing, prompt grounding rules, history capping,
 * and input length caps. No network, no API key — pure unit-level
 * checks over fixtures.
 * Run: npm run check:gemini
 */
import {
  buildClassifyPrompt,
  buildGeneralAnswerPrompt,
  buildGroundedAnswerPrompt,
  buildRewritePrompt,
  extractResponseText,
  MAX_ASK_MESSAGE,
  MAX_HISTORY_TURNS,
  MAX_SMART_QUERY,
  normalizeAskMessage,
  normalizeSmartQuery,
  parseJsonText,
  sanitizeHistory,
} from "../src/lib/gemini";
import type { ChatTurn, ProductGroup } from "../src/lib/types";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title: string, lowestLabel: string): ProductGroup {
  return {
    id: title,
    title,
    imageUrl: null,
    currency: "INR",
    lowestPrice: 100,
    lowestLabel,
    highestPrice: 200,
    highestLabel: "₹200",
    storeCount: 3,
    savingsLabel: "₹100",
    savingsPercent: 50,
    rating: 4.5,
    reviews: 100,
    offers: [],
  };
}

/* ----------------------- response text extraction --------------------- */

check(
  "single text part extracted",
  extractResponseText({
    candidates: [{ content: { parts: [{ text: "hello" }], role: "model" } }],
  }) === "hello",
);

check(
  "multiple text parts joined",
  extractResponseText({
    candidates: [{ content: { parts: [{ text: "foo" }, { text: "bar" }] } }],
  }) === "foobar",
);

check("null payload returns null", extractResponseText(null) === null);
check("undefined payload returns null", extractResponseText(undefined) === null);
check("empty object returns null", extractResponseText({}) === null);
check("missing candidates returns null", extractResponseText({ foo: 1 }) === null);
check("empty candidates returns null", extractResponseText({ candidates: [] }) === null);
check("candidates not an array returns null", extractResponseText({ candidates: "x" }) === null);
check(
  "missing content returns null",
  extractResponseText({ candidates: [{}] }) === null,
);
check(
  "missing parts returns null",
  extractResponseText({ candidates: [{ content: {} }] }) === null,
);
check(
  "empty parts returns null",
  extractResponseText({ candidates: [{ content: { parts: [] } }] }) === null,
);
check(
  "non-string text ignored, no text returns null",
  extractResponseText({ candidates: [{ content: { parts: [{ text: 42 }, { other: 1 }] } }] }) === null,
);
check(
  "whitespace-only text returns null",
  extractResponseText({ candidates: [{ content: { parts: [{ text: "   " }] } }] }) === null,
);
check(
  "malformed nested shapes never throw",
  (() => {
    try {
      return (
        extractResponseText({ candidates: [null] }) === null &&
        extractResponseText({ candidates: [{ content: null }] }) === null &&
        extractResponseText({ candidates: [{ content: { parts: [null, "x"] } }] }) === null
      );
    } catch {
      return false;
    }
  })(),
);

/* --------------------------- JSON parsing ----------------------------- */

check(
  "valid JSON parses",
  JSON.stringify(parseJsonText<{ a: number }>('{"a": 1}')) === '{"a":1}',
);
check("malformed JSON returns null", parseJsonText("{not json") === null);
check("empty string returns null", parseJsonText("") === null);
check("whitespace returns null", parseJsonText("   ") === null);
check("null returns null", parseJsonText(null) === null);
check(
  "trailing text after JSON returns null",
  parseJsonText('{"a": 1} extra') === null,
);

/* --------------------------- prompt grounding ------------------------- */

const grounded = buildGroundedAnswerPrompt("which is cheapest?", [], [
  group("Test Serum 30ml", "₹100"),
  group("Other Cream 50ml", "₹150"),
]);
check("grounded prompt names the listed products", grounded.includes("Test Serum 30ml"));
check(
  "grounded prompt forbids inventing products/prices",
  grounded.includes("Never invent a product, a store, or a price"),
);
check(
  "grounded prompt requires plain empty-result wording",
  grounded.includes("no matching products were found"),
);
check(
  "grounded prompt frames general info as not medical advice",
  grounded.includes("never as medical advice or a diagnosis"),
);
check(
  "grounded prompt caps groups at 12",
  (() => {
    const many = Array.from({ length: 20 }, (_, i) => group(`Product ${i}`, "₹100"));
    const prompt = buildGroundedAnswerPrompt("q", [], many);
    return !prompt.includes("Product 12") && prompt.includes("Product 11");
  })(),
);
check(
  "grounded prompt includes history turns",
  buildGroundedAnswerPrompt("q", [{ role: "user", content: "oily skin" }], []).includes("oily skin"),
);

const general = buildGeneralAnswerPrompt("what is niacinamide?", []);
check("general prompt refuses invented products", general.includes("Do not invent or recommend specific products"));
check("general prompt is not medical advice", general.includes("never medical advice or a diagnosis"));
check("general prompt routes medical questions to a dermatologist", general.includes("dermatologist"));

const classify = buildClassifyPrompt("find me a cheap serum", []);
check("classify prompt demands JSON only", classify.includes("JSON only"));
check("classify prompt names searchQuery", classify.includes("searchQuery"));

const rewrite = buildRewritePrompt("find me a cheap vitamin C serum please");
check("rewrite prompt demands JSON only", rewrite.includes("JSON only"));
check("rewrite prompt names rewrittenQuery", rewrite.includes("rewrittenQuery"));
check("rewrite prompt forbids adding unstated facts", rewrite.includes("Never add facts the user did not state"));

/* --------------------------- history capping -------------------------- */

const ten: ChatTurn[] = Array.from({ length: 10 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `turn ${i}`,
}));
const capped = sanitizeHistory(ten);
check(`history capped to ${MAX_HISTORY_TURNS}`, capped.length === MAX_HISTORY_TURNS);
check(
  "history keeps the LAST turns in order",
  capped[0]?.content === "turn 4" && capped[capped.length - 1]?.content === "turn 9",
);
check("short history unchanged", sanitizeHistory(ten.slice(0, 3)).length === 3);
check("non-array history returns []", sanitizeHistory("nope").length === 0);
check("null history returns []", sanitizeHistory(null).length === 0);
check(
  "malformed turns dropped, good turns kept",
  (() => {
    const out = sanitizeHistory([
      { role: "user", content: "ok" },
      { role: "system", content: "bad role" },
      { role: "user", content: 42 },
      { role: "assistant", content: "  " },
      null,
      "junk",
    ]);
    return out.length === 1 && out[0]?.content === "ok";
  })(),
);
check(
  "over-long turn content truncated to 1000 chars",
  sanitizeHistory([{ role: "user", content: "x".repeat(2000) }])[0]?.content.length === 1000,
);

/* ----------------------------- length caps ---------------------------- */

check("ask message trimmed", normalizeAskMessage("  hi  ") === "hi");
check("empty ask message rejected", normalizeAskMessage("   ") === null);
check("non-string ask message rejected", normalizeAskMessage(42) === null);
check(
  `ask message at cap (${MAX_ASK_MESSAGE}) accepted`,
  normalizeAskMessage("x".repeat(MAX_ASK_MESSAGE))?.length === MAX_ASK_MESSAGE,
);
check("ask message over cap rejected", normalizeAskMessage("x".repeat(MAX_ASK_MESSAGE + 1)) === null);
check("smart query trimmed", normalizeSmartQuery("  serum  ") === "serum");
check("empty smart query rejected", normalizeSmartQuery("") === null);
check(
  `smart query at cap (${MAX_SMART_QUERY}) accepted`,
  normalizeSmartQuery("x".repeat(MAX_SMART_QUERY))?.length === MAX_SMART_QUERY,
);
check("smart query over cap rejected", normalizeSmartQuery("x".repeat(MAX_SMART_QUERY + 1)) === null);

console.log(failures === 0 ? "\nAll gemini checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
