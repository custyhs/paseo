import { describe, expect, it } from "vitest";
import { delimitMathSource } from "./delimiters";

describe("delimitMathSource", () => {
  it("restores the author's inline delimiters", () => {
    expect(delimitMathSource("x^2", "$", "inline")).toBe("$x^2$");
    expect(delimitMathSource("x^2", "$$", "inline")).toBe("$$x^2$$");
    expect(delimitMathSource("x^2", "\\(", "inline")).toBe("\\(x^2\\)");
    expect(delimitMathSource("x^2", "\\[", "inline")).toBe("\\[x^2\\]");
  });

  it("puts block delimiters on their own lines", () => {
    expect(delimitMathSource("x = 1", "$$", "block")).toBe("$$\nx = 1\n$$");
    expect(delimitMathSource("x = 1", "\\[", "block")).toBe("\\[\nx = 1\n\\]");
  });
});
