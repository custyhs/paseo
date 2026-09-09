import { useMemo } from "react";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownTextSpan } from "@/components/markdown-text";
import type { MathBlockProps, MathInlineProps } from "./types";

// iOS and Android show the TeX source. Typesetting needs a DOM (see view.web.tsx)
// and a WebView per formula is too heavy for a chat row.

export function MathInline({ source, inheritedStyles, codeStyle }: MathInlineProps) {
  const style = useMemo(() => [inheritedStyles, codeStyle], [codeStyle, inheritedStyles]);
  return (
    <MarkdownTextSpan monoSurface style={style}>
      {source}
    </MarkdownTextSpan>
  );
}

export function MathBlock({ source, inheritedStyles, fenceStyle }: MathBlockProps) {
  return (
    <HighlightedCodeBlock
      code={source}
      language="latex"
      inheritedStyles={inheritedStyles}
      textStyle={fenceStyle}
    />
  );
}
