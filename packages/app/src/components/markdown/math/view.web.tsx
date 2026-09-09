import { useInsertionEffect, useMemo, type CSSProperties } from "react";
import { View, type ColorValue, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  markdownCopyDataSet,
} from "@/assistant-selection-copy/markup";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownTextSpan } from "@/components/markdown-text";
import type { Theme } from "@/styles/theme";
import { delimitMathSource } from "./delimiters";
import { katexCss } from "./katex-css.gen";
import { renderMathHtml } from "./render";
import type { MathBlockProps, MathInlineProps } from "./types";

// Each formula is two siblings: the KaTeX output, which the copy pipeline
// ignores and the browser cannot select, and a visually hidden span holding
// the TeX source with its delimiters, which is what a selection picks up. The
// wrapper carries the `math` copy tag so content.web.ts emits that source
// verbatim.

const STYLE_ELEMENT_ID = "paseo-katex-css";
const KATEX_OVERRIDES = `
.paseo-math-glyphs{user-select:none;-webkit-user-select:none}
.paseo-math-glyphs .katex-display{margin:0}
.paseo-math-block>.paseo-math-glyphs{overflow-x:auto;overflow-y:hidden;padding:2px 0}
.paseo-math-source{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

function ensureKatexStylesheet(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `${katexCss}\n${KATEX_OVERRIDES}`;
  document.head.append(style);
}

// `data-pmono` opts the KaTeX subtree out of the app-wide interface-font rule
// (see appearance/apply-root-font.web.ts), which would otherwise beat KaTeX's
// own font-family classes and typeset formulas in the UI font.
const GLYPH_ATTRIBUTES = { [MARKDOWN_COPY_IGNORE_ATTRIBUTE]: "true", "data-pmono": "" };

// Web styles only ever hold string colors; the opaque platform color type is
// a native-only concept.
function cssColor(color: ColorValue | undefined): string | undefined {
  return typeof color === "string" ? color : undefined;
}
const KATEX_DEFAULT_ERROR_COLOR = "#cc0000";
const RELATIVE: TextStyle = { position: "relative" };

interface ThemedMathProps {
  errorColor?: string;
}

function MathInlineImpl({
  source,
  markup,
  display,
  inheritedStyles,
  textStyle,
  errorColor = KATEX_DEFAULT_ERROR_COLOR,
}: MathInlineProps & ThemedMathProps) {
  useInsertionEffect(ensureKatexStylesheet, []);
  const html = useMemo(
    () => ({ __html: renderMathHtml(source, { displayMode: display, errorColor }) }),
    [display, errorColor, source],
  );
  const style = useMemo(() => [inheritedStyles, textStyle, RELATIVE], [inheritedStyles, textStyle]);
  return (
    <MarkdownTextSpan style={style} copyTag="math">
      <span className="paseo-math-glyphs" {...GLYPH_ATTRIBUTES} dangerouslySetInnerHTML={html} />
      <span className="paseo-math-source">{delimitMathSource(source, markup, "inline")}</span>
    </MarkdownTextSpan>
  );
}

function MathBlockImpl({
  source,
  markup,
  closed,
  inheritedStyles,
  fenceStyle,
  errorColor = KATEX_DEFAULT_ERROR_COLOR,
}: MathBlockProps & ThemedMathProps) {
  useInsertionEffect(ensureKatexStylesheet, []);
  const html = useMemo(
    () => (closed ? { __html: renderMathHtml(source, { displayMode: true, errorColor }) } : null),
    [closed, errorColor, source],
  );
  // The View has no text color of its own; the formula takes the prose color
  // and size the body style would give a paragraph here.
  const glyphStyle = useMemo<CSSProperties>(
    () => ({ color: cssColor(inheritedStyles.color), fontSize: inheritedStyles.fontSize }),
    [inheritedStyles.color, inheritedStyles.fontSize],
  );
  if (!html) {
    return (
      <HighlightedCodeBlock
        code={source}
        language="latex"
        inheritedStyles={inheritedStyles}
        textStyle={fenceStyle}
      />
    );
  }
  return (
    <View style={blockStyles.block} dataSet={markdownCopyDataSet.math}>
      <div
        className="paseo-math-glyphs"
        style={glyphStyle}
        {...GLYPH_ATTRIBUTES}
        dangerouslySetInnerHTML={html}
      />
      <span className="paseo-math-source">{delimitMathSource(source, markup, "block")}</span>
    </View>
  );
}

const blockStyles = StyleSheet.create((theme) => ({
  block: {
    position: "relative",
    width: "100%",
    marginBottom: theme.spacing[3],
  },
}));

const mapErrorColor = (theme: Theme) => ({ errorColor: theme.colors.destructive });
const ThemedMathInline = withUnistyles(MathInlineImpl);
const ThemedMathBlock = withUnistyles(MathBlockImpl);

export function MathInline(props: MathInlineProps) {
  return <ThemedMathInline {...props} uniProps={mapErrorColor} />;
}

export function MathBlock(props: MathBlockProps) {
  return <ThemedMathBlock {...props} uniProps={mapErrorColor} />;
}
