## Context

See proposal.md for motivation. Constraints that shape the approach:

- Assistant text goes through `markdown-it` v10 and `react-native-markdown-display`. The library converts markdown-it tokens to an AST and looks up a render rule by token type; unknown types render nothing. Leaf nodes receive the inherited text style (color, font size) from their ancestors.
- The assistant message builds its own rule table in `packages/app/src/components/message.tsx` (with copy-tagging datasets) and its own parser in `packages/app/src/utils/assistant-markdown-parser.ts`. It bypasses the html-ish preprocessor (`enableHtmlish={false}`), so no HTML-tokenizer protection is needed for `<` inside formulas.
- Streaming text is revealed incrementally (`docs/agent-stream-performance.md`). Every reveal step re-parses the block, so anything expensive must be memoized on the source string, and partially arrived syntax must not flicker between states.
- The app is cross-platform by default. Platform-specific implementations go in `.web.tsx` / base files, not runtime `if (isWeb)` branches.
- Expo's Metro CSS pipeline does not resolve `url()` inside imported CSS, so KaTeX's stylesheet cannot be imported as-is. The app also runs offline and from the daemon-bundled web UI, so a CDN stylesheet is not acceptable.
- Web selection copy walks the DOM, keeps elements tagged with `data-paseo-markdown-tag`, drops elements tagged with `data-paseo-markdown-ignore`, and hands the result to Turndown, which escapes markdown-significant characters in text.
- Fork rule: prefer new files at existing extension points over editing upstream code.

## Goals / Non-Goals

**Goals:**

- One new module, `packages/app/src/components/markdown/math/`, owns parsing, rendering, styling, and copy tagging for math.
- Upstream edits are limited to one added line per extension point.
- Web rendering quality matches KaTeX defaults (its own fonts), works offline, in Electron, and from the daemon-bundled web UI.

**Non-Goals:**

- Native typesetting. A WebView per formula is too heavy for chat rows; native shows source.
- Math in the markdown file preview, plan cards, or PR panel. Those surfaces keep their parsers unchanged.
- KaTeX macros, `\newcommand`, mhchem, or `\href` (trust is off).

## Decisions

### Tokenize with a local markdown-it plugin, not a published one

A ~120-line plugin adds a block rule (`math_block`) and an inline rule (`math_inline`) to the parser. It follows the delimiter validity rules used by GitHub and VS Code: an opening `$` must not be followed by whitespace, a closing `$` must not be preceded by whitespace or followed by a digit. The inline rule runs before markdown-it's `escape` rule so `\(` and `\[` are seen before the backslash is consumed; `\$` is still handled by `escape` because the inline rule only starts on a bare `$`. The block rule runs before `fence`.

Alternatives: `markdown-it-katex` (unmaintained, targets markdown-it 8-10 and renders HTML strings we would discard), `@vscode/markdown-it-katex` (requires markdown-it 12+). Owning the tokenizer avoids a version pin against upstream's markdown-it and keeps the fork's footprint self-contained.

An unterminated `$$` block consumes to the end of the document, like CommonMark fences, and is marked `meta.closed = false`. This is what gives streaming a stable shape: the block exists from the first `$$` and only its rendering changes when it closes.

### Render rules come from a factory, spread into the assistant rule table

`createMathMarkdownRules({ phase })` returns `{ math_inline, math_block }`. The assistant message spreads it into its existing `useMemo` rule table. `phase` is already a dependency of that memo, so no new re-render sources are introduced. Display math that appears inline (`$$x$$` mid-paragraph, or `\[...\]` on one line) is a `math_inline` token with `displayMode` set, so it stays inside the paragraph's text group; a block-level `$$` gets a real block token and sits between paragraphs with paragraph spacing.

### KaTeX on web, source on native, via file extensions

`view.web.tsx` calls `katex.renderToString` (`throwOnError: false`, `trust: false`, `strict: "ignore"`, default `htmlAndMathml` output for accessibility) and injects the HTML with `dangerouslySetInnerHTML` into a plain DOM element. `view.tsx` (base, used by iOS and Android) renders the source with the existing `MarkdownTextSpan` mono style or `HighlightedCodeBlock`. Output is memoized on `[source, displayMode]`, so streaming re-renders that do not change the formula are free.

Alternative considered: `output: "mathml"` to avoid shipping fonts. Rejected because Chromium's MathML Core quality depends on an installed OpenType MATH font, which macOS and Windows do not guarantee.

### Stylesheet with inlined fonts, generated and committed

`build-katex-css.mjs` reads `katex.min.css`, rewrites every `url(fonts/*.woff2)` to a base64 data URI, drops the `.woff` and `.ttf` fallbacks (all targets support woff2), and writes `katex-css.gen.ts`. `*.gen.ts` files are already excluded from formatting. The web view injects the CSS once into `document.head` from `useInsertionEffect`, so the first formula paints styled. This mirrors how the mermaid runtime ships as `html.gen.ts`.

Alternative considered: serve fonts from `public/`. Rejected because the web UI is served from different base paths (Expo dev, Cloudflare, daemon `/`, Electron `paseo://app/`) and relative font URLs would break on at least one of them.

### Copy fidelity through the existing copy-tag pipeline

The web view renders two siblings inside a wrapper tagged `data-paseo-markdown-tag="math"`: the KaTeX output tagged `data-paseo-markdown-ignore` with `user-select: none`, and a visually hidden, selectable span holding the source with its delimiters. The copy pipeline already drops ignored elements and turns tagged elements into real `<math>` elements. One Turndown rule (`filter: "math"`) returns the element's text verbatim so Turndown does not escape backslashes. Native copy (outside Paseo's handler) also yields the TeX source because the glyph markup is not selectable.

Alternative considered: KaTeX's `copy-tex` contrib. It hooks the document copy event and would fight Paseo's own selection-to-markdown handler.

## Risks / Trade-offs

- [Web bundle grows by roughly 700 KB uncompressed] → KaTeX and the stylesheet are imported only from `view.web.tsx`, so native bundles are untouched; the daemon-bundled UI already precompresses assets, and the fonts are the same ones every KaTeX site ships.
- [A false-positive `$` pair turns prose into math] → The GitHub/VS Code validity rules reject whitespace-adjacent and digit-following dollars, which covers currency. Escaped `\$` opts out explicitly.
- [Turndown collapses newlines inside the hidden source span] → Display math still round-trips as valid `$$ ... $$` on one line; formula content does not depend on line breaks.
- [`message.tsx` is large and changes upstream often] → The edit is one import and one spread; if a rebase conflicts, the resolution is re-adding those two lines.
- [Selection cannot start inside a formula] → The glyph layer is `user-select: none`; a drag across a formula still selects the hidden source. Acceptable for chat.
