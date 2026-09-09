import { renderToString } from "katex";

export interface RenderMathOptions {
  displayMode: boolean;
  errorColor: string;
}

/**
 * KaTeX with the options fixed for chat: never throw (bad TeX shows as
 * error-colored source), never trust input (no `\href`, no `\htmlClass`), and
 * keep MathML alongside the HTML so screen readers get the formula.
 */
export function renderMathHtml(source: string, { displayMode, errorColor }: RenderMathOptions) {
  return renderToString(source, {
    displayMode,
    errorColor,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
}
