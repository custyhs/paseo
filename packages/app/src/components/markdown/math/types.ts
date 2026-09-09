import type { TextStyle } from "react-native";

export interface MathInlineProps {
  source: string;
  /** Opening delimiter the author used: `$`, `$$`, `\(` or `\[`. */
  markup: string;
  display: boolean;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  codeStyle: TextStyle;
}

export interface MathBlockProps {
  source: string;
  /** Opening delimiter the author used: `$$` or `\[`. */
  markup: string;
  /** False while the closing delimiter has not streamed in yet. */
  closed: boolean;
  inheritedStyles: TextStyle;
  fenceStyle: TextStyle;
}
