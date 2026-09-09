## Why

Coding agents answer math-heavy questions (ML theory, statistics, algorithm analysis) with LaTeX: `$x^2$`, `$$ ... $$`, `\( ... \)`, `\[ ... \]`. Paseo's agent chat renders that as raw TeX source inside prose, which is hard to read on exactly the conversations where the formulas carry the meaning. Rendering the math as typeset output makes those conversations readable without leaving the app.

## What Changes

- Assistant messages in the agent chat render inline and display math with KaTeX on web (browser and Electron desktop).
- Supported delimiters: `$...$` and `\(...\)` for inline math, `$$...$$` and `\[...\]` for display math (both single-line and multi-line block forms).
- Math inside inline code and fenced code blocks is left untouched. Currency-like text (`$5 and $10`) and escaped dollars (`\$`) are not treated as math.
- While a message is streaming, an unterminated display-math block shows its TeX source in a code surface until the closing delimiter arrives, then swaps to the typeset output.
- On iOS and Android the same tokens render as monospace TeX source (inline span or code block). No WebView per formula.
- Copying a selection that spans rendered math in the assistant message copies the TeX source with its delimiters, not KaTeX's glyph markup.
- A persisted "LaTeX math" switch under Settings › Appearance (on by default) turns rendering off, restoring plain-prose delimiters in every open chat.
- Out of scope: the markdown file preview, pull request comment bodies, plan cards, KaTeX macros/mhchem, and native typesetting.

## Capabilities

### New Capabilities

- `chat-math-rendering`: typeset LaTeX math in assistant chat messages, streaming behavior, native fallback, and selection copy fidelity.

### Modified Capabilities

None.

## Impact

- New direct dependency in `packages/app`: `katex` (already present in the lockfile as a transitive dependency of `mermaid`, so the install footprint does not change).
- A generated stylesheet module (`katex-css.gen.ts`, KaTeX CSS with the woff2 fonts inlined as data URIs, roughly 400 KB) is committed next to a build script, mirroring the existing mermaid runtime pattern. Fonts are inlined because Expo's Metro CSS pipeline does not resolve `url()` assets, and the app must not depend on a CDN.
- Web bundle grows by KaTeX (about 270 KB minified) plus the stylesheet module. Native bundles do not include KaTeX.

## Upstream impact

Modified upstream files (all additive, a few lines each):

| File                                                                  | Change                                                                         | Conflict risk                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `packages/app/src/utils/assistant-markdown-parser.ts`                 | apply the math markdown-it plugin                                              | low                                                         |
| `packages/app/src/components/message.tsx`                             | import and spread the math render rules into the assistant rule set            | medium (large, upstream-active file; the edit is two lines) |
| `packages/app/src/assistant-selection-copy/markup.ts`                 | add a `math` copy tag to the dataset table                                     | low                                                         |
| `packages/app/src/assistant-selection-copy/content.web.ts`            | add one Turndown rule that emits the math element's source verbatim            | low                                                         |
| `packages/app/package.json`                                           | add the `katex` dependency and a `build:katex-css` script                      | low                                                         |
| `packages/app/src/hooks/use-settings/storage.ts`                      | add the `chatMathEnabled` setting (type, default, schema)                      | low                                                         |
| `packages/app/src/screens/settings/appearance/appearance-section.tsx` | add the switch row and its handler                                             | low                                                         |
| `packages/app/src/i18n/resources/*.ts`                                | two strings per locale for the switch                                          | low                                                         |
| `packages/app/src/types/react-native-markdown-display.d.ts`           | type `sourceMeta` on `ASTNode`, next to the existing `sourceInfo` augmentation | low                                                         |

Purely new files (no conflict risk): everything under `packages/app/src/components/markdown/math/` (markdown-it plugin, render rules, web KaTeX view, native fallback view, generated stylesheet and its build script, tests).

Overall rebase risk: low. Every upstream edit is an added line at a stable extension point (parser factory, rule table, dataset table, Turndown rule list).
