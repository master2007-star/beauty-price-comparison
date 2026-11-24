/** Selected ONDC item embedded in Digihaat's Next.js page data. */
export interface OndcProduct {
  itemId: string;
  title: string;
  price: number | null;
  currency: string | null;
}

function objectAt(text: string, start: number): Record<string, any> | null {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function extractOndcProduct(html: string, itemId?: string): OndcProduct | null {
  const decoded: string[] = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const push = /self\.__next_f\.push\((\[[\s\S]*\])\)/.exec(script[1]);
    if (!push) continue;
    try {
      const chunk = JSON.parse(push[1]);
      if (typeof chunk[1] === "string") decoded.push(chunk[1]);
    } catch { /* Unreadable page data is not product evidence. */ }
  }
  for (const text of [html, decoded.join("")]) {
    for (const marker of text.matchAll(/"item_details"\s*:\s*(\{)/g)) {
      const item = objectAt(text, marker.index! + marker[0].length - 1);
      if (!item || typeof item.id !== "string" || (itemId && item.id !== itemId)) continue;
      if (typeof item.descriptor?.name !== "string") continue;
      const measure = item.quantity?.unitized?.measure;
      const size = measure && measure.value && measure.unit ? ` ${measure.value} ${measure.unit}` : "";
      const value = typeof item.price?.value === "number" ? item.price.value : Number(item.price?.value);
      return {
        itemId: item.id, title: item.descriptor.name + size,
        price: Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null,
        currency: typeof item.price?.currency === "string" ? item.price.currency.toUpperCase() : null,
      };
    }
  }
  return null;
}
