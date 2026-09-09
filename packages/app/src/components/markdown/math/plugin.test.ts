import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { markdownMathPlugin } from "./plugin";

interface MathToken {
  type: "math_inline" | "math_block";
  content: string;
  markup: string;
  display: boolean;
  closed: boolean;
}

function createParser(): MarkdownIt {
  return createMarkdownParser({ linkify: true }).use(markdownMathPlugin);
}

function collectMath(tokens: Token[]): MathToken[] {
  const found: MathToken[] = [];
  for (const token of tokens) {
    if (token.type === "math_inline" || token.type === "math_block") {
      found.push({
        type: token.type,
        content: token.content,
        markup: token.markup,
        display: Boolean(token.meta?.display),
        closed: Boolean(token.meta?.closed),
      });
    }
    if (token.children) {
      found.push(...collectMath(token.children));
    }
  }
  return found;
}

function parseMath(source: string): MathToken[] {
  return collectMath(createParser().parse(source, {}));
}

function inlineText(source: string): string {
  const paragraph = createParser()
    .parse(source, {})
    .find((token) => token.type === "inline");
  return (paragraph?.children ?? [])
    .filter((token) => token.type === "text")
    .map((token) => token.content)
    .join("|");
}

describe("markdownMathPlugin inline math", () => {
  it("tokenizes dollar-delimited inline math", () => {
    expect(parseMath("The loss is $\\frac{1}{n}\\sum_i \\ell_i$ per batch.")).toEqual([
      {
        type: "math_inline",
        content: "\\frac{1}{n}\\sum_i \\ell_i",
        markup: "$",
        display: false,
        closed: true,
      },
    ]);
    expect(inlineText("The loss is $x$ per batch.")).toBe("The loss is | per batch.");
  });

  it("tokenizes backslash-paren inline math", () => {
    expect(parseMath("where \\(\\alpha > 0\\) holds")).toEqual([
      { type: "math_inline", content: "\\alpha > 0", markup: "\\(", display: false, closed: true },
    ]);
  });

  it("tokenizes inline double-dollar and bracket math as display", () => {
    expect(parseMath("so $$x^2$$ and \\[y^2\\] here")).toEqual([
      { type: "math_inline", content: "x^2", markup: "$$", display: true, closed: true },
      { type: "math_inline", content: "y^2", markup: "\\[", display: true, closed: true },
    ]);
  });

  it("spans a bracket pair across lines of one paragraph", () => {
    expect(parseMath("\\[ a^2 + b^2\n= c^2 \\]")).toEqual([
      {
        type: "math_inline",
        content: "a^2 + b^2\n= c^2",
        markup: "\\[",
        display: true,
        closed: true,
      },
    ]);
  });

  it("keeps an escaped dollar inside the formula", () => {
    expect(parseMath("$a \\$ b$")).toEqual([
      { type: "math_inline", content: "a \\$ b", markup: "$", display: false, closed: true },
    ]);
  });
});

describe("markdownMathPlugin leaves non-math alone", () => {
  it("does not treat currency as math", () => {
    expect(parseMath("It costs $5 and $10 respectively.")).toEqual([]);
    expect(inlineText("It costs $5 and $10 respectively.")).toBe(
      "It costs $5 and $10 respectively.",
    );
  });

  it("rejects a closing dollar followed by a digit", () => {
    expect(parseMath("between $5 and $10")).toEqual([]);
  });

  it("rejects whitespace directly inside single dollars", () => {
    expect(parseMath("a $ b $ c")).toEqual([]);
    expect(parseMath("a $b $ c")).toEqual([]);
  });

  it("keeps escaped dollars as literal text", () => {
    expect(parseMath("Use \\$HOME for the path.")).toEqual([]);
    expect(inlineText("Use \\$HOME for the path.")).toBe("Use $HOME for the path.");
  });

  it("does not look inside inline code or fences", () => {
    expect(parseMath("Run `$x$` now")).toEqual([]);
    expect(parseMath("```\n$$\nx\n$$\n```")).toEqual([]);
  });

  it("leaves an unterminated inline delimiter as text", () => {
    expect(parseMath("only $x here")).toEqual([]);
    expect(parseMath("only \\(x here")).toEqual([]);
    expect(inlineText("only \\(x here")).toBe("only (x here");
  });
});

describe("markdownMathPlugin display blocks", () => {
  it("tokenizes a multi-line double-dollar block", () => {
    expect(parseMath("Before\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n\nAfter")).toEqual([
      {
        type: "math_block",
        content: "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
        markup: "$$",
        display: true,
        closed: true,
      },
    ]);
  });

  it("tokenizes a multi-line bracket block", () => {
    expect(parseMath("\\[\na^2 + b^2 = c^2\n\\]")).toEqual([
      {
        type: "math_block",
        content: "a^2 + b^2 = c^2",
        markup: "\\[",
        display: true,
        closed: true,
      },
    ]);
  });

  it("tokenizes a single-line block", () => {
    expect(parseMath("$$ E = mc^2 $$")).toEqual([
      { type: "math_block", content: "E = mc^2", markup: "$$", display: true, closed: true },
    ]);
  });

  it("keeps content that starts on the opening line and ends on the closing line", () => {
    expect(parseMath("$$ \\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned} $$")).toEqual([
      {
        type: "math_block",
        content: "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}",
        markup: "$$",
        display: true,
        closed: true,
      },
    ]);
  });

  it("interrupts a paragraph", () => {
    const tokens = createParser().parse("Text\n$$\nx\n$$", {});
    expect(tokens.map((token) => token.type)).toEqual([
      "paragraph_open",
      "inline",
      "paragraph_close",
      "math_block",
    ]);
  });

  it("marks an unterminated double-dollar block as not closed and consumes the rest", () => {
    expect(parseMath("$$\n\\frac{a}{b}\n\nmore text")).toEqual([
      {
        type: "math_block",
        content: "\\frac{a}{b}\n\nmore text",
        markup: "$$",
        display: true,
        closed: false,
      },
    ]);
  });

  it("only opens a bracket block on its own line", () => {
    expect(parseMath("\\[1\\] Reference one\n\\[2\\] Reference two")).toEqual([
      { type: "math_inline", content: "1", markup: "\\[", display: true, closed: true },
      { type: "math_inline", content: "2", markup: "\\[", display: true, closed: true },
    ]);
  });

  it("works inside a list item", () => {
    expect(parseMath("- item\n\n  $$\n  x = 1\n  $$")).toEqual([
      { type: "math_block", content: "x = 1", markup: "$$", display: true, closed: true },
    ]);
  });
});
