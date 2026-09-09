import type MarkdownIt from "markdown-it";
// @types/markdown-it only resolves its `.mjs` paths; the imports are type-only,
// so the CommonJS markdown-it 10 runtime never sees them.
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Tokenizes TeX math for the assistant chat parser.
 *
 * Emits two token types that react-native-markdown-display hands to render
 * rules of the same name:
 * - `math_inline` (inline, `meta.display` true for `$$…$$` / `\[…\]` inside a
 *   paragraph)
 * - `math_block` (block, `meta.closed` false while the closing delimiter has
 *   not arrived — streaming renders those as source)
 *
 * Delimiter validity follows GitHub and VS Code: an opening `$` must not be
 * followed by whitespace, a closing `$` must not be preceded by whitespace or
 * followed by a digit, so `$5 and $10` stays prose. An unterminated `$$` block
 * consumes to the end of the document like a CommonMark fence; a `\[` block
 * only opens on its own line so `\[1\] Reference` stays a paragraph.
 */
export function markdownMathPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  // Before `escape` so `\(` and `\[` are seen before the backslash is eaten.
  md.inline.ruler.before("escape", "math_inline", mathInline);
}

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const OPEN_PAREN = 0x28;
const OPEN_BRACKET = 0x5b;

interface MathMeta {
  display: boolean;
  closed: boolean;
}

interface BlockOpener {
  markup: "$$" | "\\[";
  closer: "$$" | "\\]";
}

function matchBlockOpener(src: string, pos: number): BlockOpener | null {
  const first = src.charCodeAt(pos);
  const second = src.charCodeAt(pos + 1);
  if (first === DOLLAR && second === DOLLAR) {
    return { markup: "$$", closer: "$$" };
  }
  if (first === BACKSLASH && second === OPEN_BRACKET) {
    return { markup: "\\[", closer: "\\]" };
  }
  return null;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const opener = matchBlockOpener(state.src, pos);
  if (!opener) {
    return false;
  }
  const { markup, closer } = opener;
  const openingRest = state.src.slice(pos + 2, state.eMarks[startLine]).trimEnd();
  const closesOnOpeningLine = openingRest.length >= closer.length && openingRest.endsWith(closer);
  if (markup === "\\[" && openingRest.length > 0 && !closesOnOpeningLine) {
    return false;
  }
  if (silent) {
    return true;
  }

  let content: string;
  let nextLine = startLine;
  let closed = false;
  if (closesOnOpeningLine) {
    content = openingRest.slice(0, -closer.length);
    closed = true;
  } else {
    const lines: string[] = openingRest.length > 0 ? [openingRest] : [];
    for (;;) {
      nextLine += 1;
      if (nextLine >= endLine) {
        break;
      }
      const text = lineText(state, nextLine);
      if (text.length > 0 && state.sCount[nextLine] < state.blkIndent) {
        // A non-empty line dedented past the parent ends the parent (list, quote).
        break;
      }
      const trimmed = text.trimEnd();
      if (trimmed.endsWith(closer)) {
        lines.push(trimmed.slice(0, -closer.length));
        closed = true;
        break;
      }
      lines.push(text);
    }
    content = lines.join("\n");
  }

  state.line = closed ? nextLine + 1 : nextLine;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content.trim();
  token.markup = markup;
  token.map = [startLine, state.line];
  const meta: MathMeta = { display: true, closed };
  token.meta = meta;
  return true;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function findClosingDollar(src: string, from: number, max: number, double: boolean): number {
  const closer = double ? "$$" : "$";
  let search = from;
  while (search < max) {
    const index = src.indexOf(closer, search);
    if (index === -1 || index + closer.length > max) {
      return -1;
    }
    const escaped = src.charCodeAt(index - 1) === BACKSLASH;
    const afterWhitespace = !double && isWhitespace(src.charCodeAt(index - 1));
    const beforeDigit = !double && isDigit(src.charCodeAt(index + 1));
    if (escaped || afterWhitespace || beforeDigit) {
      search = index + 1;
      continue;
    }
    return index;
  }
  return -1;
}

function pushInline(
  state: StateInline,
  markup: string,
  content: string,
  display: boolean,
  end: number,
): void {
  const token = state.push("math_inline", "math", 0);
  token.markup = markup;
  token.content = content;
  const meta: MathMeta = { display, closed: true };
  token.meta = meta;
  state.pos = end;
}

function dollarInline(state: StateInline, silent: boolean): boolean {
  const { src, pos: start, posMax: max } = state;
  const double = src.charCodeAt(start + 1) === DOLLAR;
  const openLength = double ? 2 : 1;
  if (!double && (start + 1 >= max || isWhitespace(src.charCodeAt(start + 1)))) {
    return false;
  }
  const close = findClosingDollar(src, start + openLength, max, double);
  if (close === -1) {
    return false;
  }
  const raw = src.slice(start + openLength, close);
  const content = double ? raw.trim() : raw;
  if (content.length === 0) {
    return false;
  }
  if (!silent) {
    pushInline(state, double ? "$$" : "$", content, double, close + openLength);
  } else {
    state.pos = close + openLength;
  }
  return true;
}

function backslashInline(state: StateInline, silent: boolean): boolean {
  const { src, pos: start, posMax: max } = state;
  const next = src.charCodeAt(start + 1);
  if (next !== OPEN_PAREN && next !== OPEN_BRACKET) {
    return false;
  }
  const display = next === OPEN_BRACKET;
  const closer = display ? "\\]" : "\\)";
  const close = src.indexOf(closer, start + 2);
  if (close === -1 || close + 2 > max) {
    return false;
  }
  const content = src.slice(start + 2, close).trim();
  if (content.length === 0) {
    return false;
  }
  if (!silent) {
    pushInline(state, display ? "\\[" : "\\(", content, display, close + 2);
  } else {
    state.pos = close + 2;
  }
  return true;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const code = state.src.charCodeAt(state.pos);
  if (code === DOLLAR) {
    return dollarInline(state, silent);
  }
  if (code === BACKSLASH) {
    return backslashInline(state, silent);
  }
  return false;
}
