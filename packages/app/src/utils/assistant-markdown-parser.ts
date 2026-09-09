import type MarkdownIt from "markdown-it";
import { markdownMathPlugin } from "@/components/markdown/math/plugin";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true }).use(markdownMathPlugin);
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Assistant messages are the only surface allowed to link into the
  // filesystem. Every other parser keeps markdown-it's stricter default.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
