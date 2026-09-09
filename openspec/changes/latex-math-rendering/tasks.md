## 1. Parser

- [x] 1.1 Add `katex` as a direct dependency of `packages/app` and verify `npm ls katex` resolves the already-locked 0.16.x without changing `package-lock.json` beyond the new edge
- [x] 1.2 Write `packages/app/src/components/markdown/math/plugin.test.ts` and `plugin.ts` (markdown-it block and inline rules for `$`, `$$`, `\(`, `\[`; `meta.closed` on blocks; currency, escaped dollar, and code-span exclusions) and verify `npx vitest run packages/app/src/components/markdown/math/plugin.test.ts --bail=1` passes
- [x] 1.3 Apply the plugin in `packages/app/src/utils/assistant-markdown-parser.ts` and verify a parser test in `plugin.test.ts` shows the assistant parser emits `math_inline` and `math_block` tokens

## 2. Rendering

- [x] 2.1 Generate `katex-css.gen.ts` with `build-katex-css.mjs` (woff2 inlined, woff/ttf dropped), add the `build:katex-css` script to `packages/app/package.json`, and verify the generated module exports a CSS string that contains no `url(fonts/` references
- [x] 2.2 Write `render.test.ts` and `render.ts` (pure `renderMathHtml` wrapper around KaTeX with fixed options) and verify the test shows typeset output for valid TeX, error-styled source for invalid TeX, and no anchor element for `\href`
- [x] 2.3 Write `view.web.tsx` (KaTeX output, style injection, copy-tag wrapper with hidden source span) with a jsdom test and verify the test passes and the stylesheet is injected once across two mounts
- [x] 2.4 Write `view.tsx` (native fallback: mono inline span, code block for display) and verify `npm run typecheck --workspace=@getpaseo/app` passes
- [x] 2.5 Write `rules.tsx` (`createMathMarkdownRules({ phase })`) and spread it into the assistant rule table in `packages/app/src/components/message.tsx`; verify typecheck and lint pass

## 3. Copy

- [x] 3.1 Add the `math` copy tag to `packages/app/src/assistant-selection-copy/markup.ts` and the verbatim Turndown rule to `content.web.ts`; verify a new case in `content.browser.test.ts` copies `The loss is $x^2$ per batch.` verbatim via `npx vitest run packages/app/src/assistant-selection-copy/content.browser.test.ts --project browser`

## 4. Verification

- [x] 4.1 Run `npm run typecheck`, `npm run lint`, and `npm run format` at the repo root and verify all pass with no diff from the formatter
- [x] 4.2 Start the dev daemon and Expo web, send a math-heavy prompt to an agent, and verify inline and display math render typeset in the chat and a streaming `$$` block shows source until it closes (screenshot as evidence)

## 5. Rendering toggle

- [x] 5.1 Add `chatMathEnabled` (default true) to the app settings type, defaults, and persisted schema; verify the storage test covers the default and a persisted `false`
- [x] 5.2 Make math opt-in on `createAssistantMarkdownParser({ math })` and read the setting in the assistant message; verify the parser test shows `$x^2$` staying prose when off
- [x] 5.3 Add the "LaTeX math" switch row to Settings › Appearance with strings in all nine locales; verify the locale parity test passes and toggling the switch in the running web app swaps formulas and source without a reload
