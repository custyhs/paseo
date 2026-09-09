import type { ReactNode } from "react";
import type { TextStyle } from "react-native";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { MarkdownStyles } from "@/components/markdown/renderer";
import { MathBlock, MathInline } from "./view";

interface MathMeta {
  display: boolean;
  closed: boolean;
}

// `sourceMeta` is whatever the tokenizer put on `token.meta`; the plugin owns
// that shape, so a missing flag reads as false rather than as an error.
function readMathMeta(node: ASTNode): MathMeta {
  const meta = node.sourceMeta;
  if (typeof meta !== "object" || meta === null) {
    return { display: false, closed: false };
  }
  return {
    display: "display" in meta && meta.display === true,
    closed: "closed" in meta && meta.closed === true,
  };
}

/** Render rules for the `math_inline` and `math_block` tokens from `plugin.ts`. */
export const mathMarkdownRules: RenderRules = {
  math_inline: (
    node: ASTNode,
    _children: ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
    inheritedStyles: TextStyle = {},
  ) => (
    <MathInline
      key={node.key}
      source={node.content}
      markup={node.markup}
      display={readMathMeta(node).display}
      inheritedStyles={inheritedStyles}
      textStyle={styles.text}
      codeStyle={styles.code_inline}
    />
  ),
  math_block: (
    node: ASTNode,
    _children: ReactNode[],
    _parent: ASTNode[],
    styles: MarkdownStyles,
    inheritedStyles: TextStyle = {},
  ) => (
    <MathBlock
      key={node.key}
      source={node.content}
      markup={node.markup}
      closed={readMathMeta(node).closed}
      inheritedStyles={inheritedStyles}
      fenceStyle={styles.fence}
    />
  ),
};
