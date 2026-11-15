"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { askAi, LockedError } from "@/lib/client-api";
import type { ChatTurn, ProductGroup } from "@/lib/types";

interface AiChatProps {
  /** Server-decided via /api/status. When false, nothing renders at all. */
  geminiConfigured: boolean;
  /** Run a normal search for the query and put it in the main search box. */
  onShowResults: (query: string) => void;
}

interface ChatMessage extends ChatTurn {
  /** Real groups the answer was grounded on, when the answer searched. */
  groups?: ProductGroup[];
  searchQuery?: string | null;
}

const WELCOME_TEXT =
  "Hi! Ask me for a product — say “a vitamin C serum for oily skin” — and I'll search live prices across stores. I only talk about real results, never invented prices.";

/**
 * Floating AI advisor chat. Renders nothing when Gemini is unconfigured.
 * The panel is a fixed bottom-right sheet (full-width on narrow screens),
 * transform-only entrance, closable, Escape closes it. Answers that
 * carried real search results show up to 3 mini-cards plus a button that
 * hands the query to the main search.
 */
export default function AiChat({ geminiConfigured, onShowResults }: AiChatProps) {
  const [open, setOpen] = useState(false);
  // Real conversation turns only — the welcome bubble renders statically
  // and is never sent as history.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, pending, reduceMotion]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  if (!geminiConfigured) return null;

  async function send(text: string) {
    const message = text.trim();
    if (message.length === 0 || pending) return;
    setFailed(null);
    setInput("");
    // History = the turns before this one; the server caps to the last 6.
    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setPending(true);
    try {
      const res = await askAi(message, history);
      if (res.status === "not_configured") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "The AI advisor hasn't been set up on this site yet." },
        ]);
      } else if (res.status === "error" || !res.answer) {
        setFailed(message);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.message ?? "The AI advisor is unavailable right now. Please try again in a moment.",
          },
        ]);
      } else {
        const answer: string = res.answer;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer, groups: res.groups ?? [], searchQuery: res.searchQuery ?? null },
        ]);
      }
    } catch (e) {
      if (e instanceof LockedError) return; // LockGate re-opens.
      setFailed(message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong reaching the AI advisor. Please try again." },
      ]);
    } finally {
      setPending(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <>
      {!open ? (
        <button type="button" className="ai-fab" onClick={() => setOpen(true)} aria-label="Ask the AI beauty advisor">
          ✦ Ask AI
        </button>
      ) : null}

      {open ? (
        <motion.section
          className="ai-panel"
          role="dialog"
          aria-label="AI beauty advisor"
          initial={reduceMotion ? false : { y: 24 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        >
          <div className="ai-head">
            <div>
              <p className="ai-title">Ask AI</p>
              <p className="ai-sub">Grounded on live prices — never invented.</p>
            </div>
            <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
          </div>

          <div className="ai-messages" ref={scrollRef}>
            <div className="ai-msg is-ai">
              <p className="ai-bubble">{WELCOME_TEXT}</p>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role === "user" ? "is-user" : "is-ai"}`}>
                <p className="ai-bubble">{m.content}</p>
                {m.role === "assistant" && m.groups && m.groups.length > 0 ? (
                  <div className="ai-cards">
                    {m.groups.slice(0, 3).map((g) => (
                      <div className="ai-card" key={g.id}>
                        <p className="ai-card-title">{g.title}</p>
                        <p className="ai-card-meta">
                          from {g.lowestLabel} · {g.storeCount} store{g.storeCount === 1 ? "" : "s"}
                          {g.rating !== null ? ` · ★ ${g.rating}` : ""}
                        </p>
                      </div>
                    ))}
                    {m.searchQuery ? (
                      <button
                        type="button"
                        className="btn btn-sm ai-see-results"
                        onClick={() => {
                          setOpen(false);
                          onShowResults(m.searchQuery as string);
                        }}
                      >
                        See these results →
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            {pending ? (
              <div className="ai-msg is-ai">
                <p className="ai-bubble ai-thinking" role="status">
                  Thinking…
                </p>
              </div>
            ) : null}
            {failed && !pending ? (
              <div className="ai-retry">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send(failed)}>
                  Retry
                </button>
              </div>
            ) : null}
          </div>

          <form className="ai-form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="ai-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask for a product or skincare help…"
              aria-label="Message the AI advisor"
              autoComplete="off"
              maxLength={500}
            />
            <button className="btn btn-sm" type="submit" disabled={pending || input.trim().length === 0}>
              Send
            </button>
          </form>
        </motion.section>
      ) : null}
    </>
  );
}
