const CLOSERS: Record<string, string> = {
  $: "$",
  $$: "$$",
  "\\(": "\\)",
  "\\[": "\\]",
};

/** Rebuilds the source text the author wrote, so copying math round-trips. */
export function delimitMathSource(
  source: string,
  markup: string,
  layout: "inline" | "block",
): string {
  const closer = CLOSERS[markup] ?? markup;
  if (layout === "block") {
    return `${markup}\n${source}\n${closer}`;
  }
  return `${markup}${source}${closer}`;
}
