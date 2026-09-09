## Purpose

Typeset LaTeX math inside assistant chat messages so that math-heavy agent answers read as formulas instead of raw TeX source, while keeping streaming, native platforms, and copy behavior predictable.

## ADDED Requirements

### Requirement: Inline math renders as typeset output on web

Assistant messages on web (browser and Electron desktop) SHALL render inline math delimited by `$...$` or `\(...\)` as typeset math in the flow of the surrounding text, inheriting the surrounding text color.

#### Scenario: Dollar-delimited inline math

- **WHEN** an assistant message contains `The loss is $\frac{1}{n}\sum_i \ell_i$ per batch.`
- **THEN** the text before and after the formula renders as prose and the formula renders as a typeset fraction and sum on the same line

#### Scenario: Backslash-paren inline math

- **WHEN** an assistant message contains `where \(\alpha > 0\) holds`
- **THEN** the formula renders as typeset math on the same line as the prose

### Requirement: Display math renders as a centered block on web

Assistant messages on web SHALL render display math delimited by `$$...$$` or `\[...\]` as a centered block. Both the single-line form (`$$ E = mc^2 $$`) and the multi-line form (opening delimiter on its own line, closing delimiter on its own line) SHALL be recognized. A block wider than the message SHALL scroll horizontally instead of overflowing the message.

#### Scenario: Multi-line display block

- **WHEN** an assistant message contains a line `$$`, followed by `\int_0^1 x^2 \, dx = \frac{1}{3}`, followed by a line `$$`
- **THEN** the formula renders as a centered typeset block between the surrounding paragraphs

#### Scenario: Bracket display block

- **WHEN** an assistant message contains a line `\[`, followed by `a^2 + b^2 = c^2`, followed by a line `\]`
- **THEN** the formula renders as a centered typeset block

#### Scenario: Single-line display block

- **WHEN** an assistant message contains the line `$$ E = mc^2 $$`
- **THEN** the formula renders as a centered typeset block

### Requirement: Text that is not math is left untouched

The renderer SHALL NOT treat the following as math: dollar signs followed or preceded by whitespace (`$5 and $10`), escaped dollars (`\$`), and any delimiter inside inline code or fenced code blocks.

#### Scenario: Currency amounts

- **WHEN** an assistant message contains `It costs $5 and $10 respectively.`
- **THEN** the sentence renders as plain prose with both dollar signs visible

#### Scenario: Escaped dollar

- **WHEN** an assistant message contains `Use \$HOME for the path.`
- **THEN** the text renders as `Use $HOME for the path.`

#### Scenario: Math delimiters inside code

- **WHEN** an assistant message contains `` `$x$` `` or a fenced code block containing `$$`
- **THEN** the code renders verbatim and no math is typeset

### Requirement: Invalid TeX degrades to visible source

When a formula cannot be typeset, the renderer SHALL show the TeX source in place, highlighted as an error, instead of hiding the formula or breaking the message.

#### Scenario: Unknown command

- **WHEN** an assistant message contains `$\notacommand{x}$`
- **THEN** the source `\notacommand{x}` is visible in place, styled as an error, and the rest of the message renders normally

### Requirement: Streaming shows unterminated display math as source

While a message is streaming, a display-math block whose closing delimiter has not arrived SHALL render its TeX source in a code surface. When the closing delimiter arrives, the block SHALL swap to typeset output.

#### Scenario: Block closes during streaming

- **WHEN** the streamed text so far ends with `$$\n\frac{a}{b}` and no closing `$$` has arrived
- **THEN** the block shows `\frac{a}{b}` as monospace source
- **WHEN** the closing `$$` arrives
- **THEN** the same block shows the typeset fraction

### Requirement: Native platforms show TeX source

On iOS and Android, inline math SHALL render as a monospace inline span containing the TeX source, and display math SHALL render as a monospace code block containing the TeX source.

#### Scenario: Inline math on iOS

- **WHEN** an assistant message containing `$x^2$` is viewed on iOS
- **THEN** `x^2` is shown inline in a monospace code style and the surrounding prose is unchanged

### Requirement: Copying a selection preserves TeX source

On web, copying a selection of an assistant message that includes rendered math SHALL place the TeX source with its original delimiters into the clipboard markdown, and SHALL NOT include the typeset glyph markup.

#### Scenario: Copy a sentence with inline math

- **WHEN** the user selects and copies `The loss is $x^2$ per batch.` from a rendered assistant message
- **THEN** the clipboard markdown is `The loss is $x^2$ per batch.`

#### Scenario: Copy a display block

- **WHEN** the user selects and copies a paragraph followed by a rendered `$$ ... $$` block
- **THEN** the clipboard markdown contains the paragraph followed by the block source wrapped in `$$` delimiters
