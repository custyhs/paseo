import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

describe("createAssistantMarkdownParser", () => {
  it("renders agent text verbatim", () => {
    const parser = createAssistantMarkdownParser({ math: true });

    // The reported bug, plus the substitutions that share its cause.
    expect(parser.renderInline("(c) (C) (r) (tm) (p)")).toBe("(c) (C) (r) (tm) (p)");
    expect(parser.renderInline("wait for it...")).toBe("wait for it...");
    expect(parser.renderInline("a -- b")).toBe("a -- b");
    // Smart quotes are off too: a curled quote is not pasteable into a shell.
    expect(parser.renderInline(`run --name="my repo"`)).toBe("run --name=&quot;my repo&quot;");
    expect(parser.renderInline("it's fine")).toBe("it's fine");
  });

  it("allows file:// links, unlike every other parser", () => {
    const parser = createAssistantMarkdownParser({ math: true });

    expect(parser.render("[open](file:///tmp/a.ts)")).toContain('href="file:///tmp/a.ts"');
  });

  it("still rejects javascript: links", () => {
    const parser = createAssistantMarkdownParser({ math: true });

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });
});

describe("createAssistantMarkdownParser math", () => {
  it("emits math tokens for inline and display math", () => {
    const parser = createAssistantMarkdownParser({ math: true });
    const tokens = parser.parse("Loss $x^2$ here\n\n$$\ny = 1\n$$", {});
    const inline = tokens.find((token) => token.type === "inline");

    expect(inline?.children?.map((token) => token.type)).toEqual(["text", "math_inline", "text"]);
    expect(tokens.map((token) => token.type)).toEqual([
      "paragraph_open",
      "inline",
      "paragraph_close",
      "math_block",
    ]);
  });

  it("leaves math delimiters as prose when math rendering is off", () => {
    const parser = createAssistantMarkdownParser({ math: false });
    const tokens = parser.parse("Loss $x^2$ here\n\n$$\ny = 1\n$$", {});
    const types = new Set(
      tokens.flatMap((token) => (token.children ?? []).concat(token)).map((t) => t.type),
    );

    expect(types.has("math_inline")).toBe(false);
    expect(types.has("math_block")).toBe(false);
    expect(parser.renderInline("Loss $x^2$ here")).toBe("Loss $x^2$ here");
  });
});
