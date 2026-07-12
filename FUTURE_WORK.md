# Future work

## Product direction

Keep reveal-editor focused on being a local, Git-friendly visual editor for
plain reveal.js HTML. The HTML deck remains the source of truth and must stay
readable, portable, and safe to edit by hand.

Quarto remains the better tool when a presentation is primarily generated from
code, citations, computed tables, or other reproducible research artifacts. A
future one-way "eject from Quarto" workflow may be useful, but reveal-editor
should not grow a second source model or attempt to rewrite QMD.

## Non-negotiable engineering rules

1. A no-op save remains byte-identical.
2. Every persisted feature gets a full client-cleaner-server round-trip test.
3. Editor-only DOM, Reveal runtime state, rendered KaTeX, and highlighted code
   never leak into saved slide markup.
4. Existing custom HTML and CSS are preserved unless the user explicitly
   changes them.
5. Decks remain presentable offline without reveal-editor installed.

## Priorities

### 1. Make reveal.js approachable

- [x] Select and preview the vendored reveal.js themes.
- [x] Add deck typography controls with conservative system-font presets.
- [x] Add a small set of useful slide layouts: title, title-and-body,
      two-column, image-focus, and blank.
- [x] Add alignment and equal-spacing actions for selected elements.
- [x] Improve first-run guidance and empty-slide affordances.

### 2. Complete core reveal.js authoring

- [x] Represent vertical slide stacks in the sidebar and support reordering
      within and between stacks.
- [x] Edit speaker notes using native `<aside class="notes">` markup.
- [x] Configure slide transitions and per-slide transition overrides.
- [x] Add a safe raw-HTML block for advanced embeds and custom interactions.
- [x] Add presentation/print entry points, including reveal.js PDF mode.

### 3. Strengthen visual composition

- [x] Add multi-selection alignment and distribution.
- [x] Add aspect-ratio locking and numeric position/rotation controls.
- [x] Add grouping without introducing opaque saved markup.
- [x] Add reusable user-defined slide templates.
- [x] Improve layer naming and accessibility labels.

### 4. Interoperate without becoming Quarto

- [ ] Document using generated plots and assets from Julia, Python, or R in an
      HTML-native deck.
- [ ] Prototype a one-way Quarto HTML import/eject command with an explicit
      warning that subsequent QMD renders will not update the ejected deck.
- [ ] Explore copying individual rendered Quarto elements rather than importing
      an entire generated presentation.

### 5. Reliability and maintainability

- [ ] Add real-browser coverage for Reveal lifecycle, settings, themes, media,
      and save/reload behavior.
- [ ] Exercise all supported operating systems in CI.
- [ ] Add fixtures for older and heavily customized reveal.js decks.
- [ ] Keep the editor dependency-light and split large action/panel modules as
      features accumulate.

## Explicitly out of scope for now

- Accounts, billing, hosted collaboration, and cloud storage.
- A proprietary JSON presentation format.
- Reimplementing Quarto computation, citations, or QMD serialization.
- PPTX fidelity as a primary design constraint.
