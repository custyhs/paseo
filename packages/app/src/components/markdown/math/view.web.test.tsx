// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MathBlock, MathInline } from "./view";

vi.stubGlobal("React", React);

vi.mock("@/components/highlighted-code-block", () => ({
  HighlightedCodeBlock: ({ code }: { code: string }) => (
    <pre data-testid="source-block">{code}</pre>
  ),
}));

const STYLE_SELECTOR = "style#paseo-katex-css";
const NO_STYLE = {};
const PROSE_STYLE = { color: "rgb(1, 2, 3)" };
const PROSE_BLOCK_STYLE = { color: "rgb(1, 2, 3)", fontSize: 15 };
const MATH_SELECTOR = '[data-paseo-markdown-tag="math"]';
const IGNORED_SELECTOR = "[data-paseo-markdown-ignore]";

afterEach(() => {
  document.head.replaceChildren();
});

describe("MathInline on web", () => {
  it("typesets the formula, hides its source for copying, and injects KaTeX styles once", () => {
    const first = render(
      <MathInline
        source="x^2"
        markup="$"
        display={false}
        inheritedStyles={PROSE_STYLE}
        textStyle={NO_STYLE}
        codeStyle={NO_STYLE}
      />,
    );
    const wrapper = first.container.querySelector(MATH_SELECTOR);
    const glyphs = wrapper?.querySelector(IGNORED_SELECTOR);
    const source = wrapper?.querySelector(".paseo-math-source");

    expect(glyphs?.querySelector(".katex")).not.toBeNull();
    expect(glyphs?.querySelector(".katex-display")).toBeNull();
    expect(glyphs?.hasAttribute("data-pmono")).toBe(true);
    expect(source?.textContent).toBe("$x^2$");
    expect(document.querySelectorAll(STYLE_SELECTOR)).toHaveLength(1);
    expect(document.querySelector(STYLE_SELECTOR)?.textContent).toContain("font-family:KaTeX_Main");

    render(
      <MathInline
        source="y"
        markup={"\\("}
        display={false}
        inheritedStyles={NO_STYLE}
        textStyle={NO_STYLE}
        codeStyle={NO_STYLE}
      />,
    );
    expect(document.querySelectorAll(STYLE_SELECTOR)).toHaveLength(1);
  });

  it("renders inline double-dollar math in display mode", () => {
    const view = render(
      <MathInline
        source={"\\sum_i x_i"}
        markup="$$"
        display
        inheritedStyles={NO_STYLE}
        textStyle={NO_STYLE}
        codeStyle={NO_STYLE}
      />,
    );

    expect(view.container.querySelector(".katex-display")).not.toBeNull();
    expect(view.container.querySelector(".paseo-math-source")?.textContent).toBe("$$\\sum_i x_i$$");
  });
});

describe("MathBlock on web", () => {
  it("typesets a closed block with the prose color and block delimiters for copy", () => {
    const view = render(
      <MathBlock
        source="x = 1"
        markup="$$"
        closed
        inheritedStyles={PROSE_BLOCK_STYLE}
        fenceStyle={NO_STYLE}
      />,
    );
    const wrapper = view.container.querySelector<HTMLElement>(MATH_SELECTOR);
    const glyphs = wrapper?.querySelector<HTMLElement>(IGNORED_SELECTOR);

    expect(glyphs?.querySelector(".katex-display")).not.toBeNull();
    expect(glyphs?.hasAttribute("data-pmono")).toBe(true);
    expect(glyphs?.style.color).toBe("rgb(1, 2, 3)");
    expect(glyphs?.style.fontSize).toBe("15px");
    expect(wrapper?.querySelector(".paseo-math-source")?.textContent).toBe("$$\nx = 1\n$$");
    expect(view.queryByTestId("source-block")).toBeNull();
  });

  it("shows the source in a code block while the closing delimiter is missing", () => {
    const view = render(
      <MathBlock
        source={"\\frac{a}{b}"}
        markup="$$"
        closed={false}
        inheritedStyles={NO_STYLE}
        fenceStyle={NO_STYLE}
      />,
    );

    expect(view.getByTestId("source-block").textContent).toBe("\\frac{a}{b}");
    expect(view.container.querySelector(".katex")).toBeNull();
    expect(view.container.querySelector(MATH_SELECTOR)).toBeNull();
  });
});
