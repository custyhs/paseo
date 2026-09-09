import { describe, expect, it } from "vitest";
import { renderMathHtml } from "./render";

describe("renderMathHtml", () => {
  it("typesets valid TeX with an accessible source annotation", () => {
    const html = renderMathHtml("x^2", { displayMode: false, errorColor: "#b04138" });

    expect(html).toContain('class="katex"');
    expect(html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    expect(html).not.toContain("katex-display");
  });

  it("wraps display math in the display container", () => {
    const html = renderMathHtml("\\int_0^1 x", { displayMode: true, errorColor: "#b04138" });

    expect(html).toContain('class="katex-display"');
  });

  it("shows an unknown command as error-colored source instead of throwing", () => {
    const html = renderMathHtml("\\notacommand{x}", { displayMode: false, errorColor: "#b04138" });

    expect(html).toContain("\\notacommand");
    expect(html).toContain("color:#b04138");
  });

  it("shows unparseable TeX as error-colored source instead of throwing", () => {
    const html = renderMathHtml("\\frac{a}{", { displayMode: false, errorColor: "#b04138" });

    expect(html).toContain('class="katex-error"');
    expect(html).toContain("\\frac{a}{");
    expect(html).toContain("color:#b04138");
  });

  it("does not emit links for untrusted commands", () => {
    const html = renderMathHtml("\\href{https://example.com}{x}", {
      displayMode: false,
      errorColor: "#b04138",
    });

    expect(html).not.toContain("<a ");
  });
});
