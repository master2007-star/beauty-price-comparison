/**
 * Rolling label for primary buttons (AestheticMatch-style repeating-text
 * button): two copies of the label are stacked and, on hover of a
 * `.roll-btn` ancestor, the stack slides up one line so the duplicate rolls
 * into place. Transform-only; at rest the render is a single line of text,
 * identical to a plain label. The duplicate copy is aria-hidden so screen
 * readers hear the label once. Motion is disabled under
 * prefers-reduced-motion (see globals.css).
 */
export default function RollLabel({ text }: { text: string }) {
  return (
    <span className="roll-label">
      <span className="roll-line">{text}</span>
      <span className="roll-line" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
