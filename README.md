# reveal-editor

A local WYSIWYG editor for [reveal.js](https://revealjs.com/) presentations —
drag elements around like slides.com, but the deck stays a **plain,
hand-editable HTML file** that you own, keep in git, and present anywhere
with nothing but a browser.

## How it works

The deck HTML file is the single source of truth. The editor loads your
`deck.html` in an iframe running real reveal.js, lets you edit it visually,
and on save writes clean HTML back — only the content inside
`<div class="slides">` is (deterministically) rewritten; every byte outside
it (your head, scripts, comments, custom CSS) is preserved untouched. A
no-op save is byte-identical, and a drag produces a one-attribute git diff.

You can freely alternate between the GUI and a text editor: external file
changes hot-reload the editor, and anything you write by hand survives the
next GUI save.

## Install (per machine)

Needs Node.js ≥ 20.

```sh
git clone <your-repo-url> reveal-editor
cd reveal-editor
npm install
```

No build step — the editor UI ships pre-built in `dist/`.

## Usage

```sh
# create a new presentation (self-contained folder)
npm run edit -- new ~/talks/egu2026

# edit an existing one
npm run edit -- ~/talks/egu2026/deck.html

# options: --port <n>, --no-open, --dev (editor UI from source)
```

The browser opens automatically. To **present**, just open `deck.html` in
any browser — each deck folder vendors its own pinned copy of reveal.js and
KaTeX (`reveal/`), so decks work offline, forever, with no dependency on
this editor.

## Editing

- **Select**: click; shift-click or rubber-band for multi-select; Escape clears
- **Move/resize/rotate**: drag the handles; snapping to slide edges/centers
  and sibling elements; arrow keys nudge (Shift = 10 px)
- **Insert** (toolbar): text box, image (file picker or just Ctrl+V a
  screenshot — saved to `assets/`), rectangle/ellipse/line/arrow, LaTeX
  math (∑), code block (`{}`)
- **Text**: double-click to edit in place; bold/italic/underline/lists in
  the context bar; font size and color apply to the whole box
- **Math**: double-click a formula → popover with raw LaTeX, live preview
  on the slide; `\( … \)` inline, `$$ … $$` display
- **Code**: double-click a code block → popover with raw source + language
  (Julia included), highlighted by the deck's own highlight.js
- **Slides**: sidebar thumbnails — click to jump, drag to reorder, buttons
  to add/duplicate/delete; slide background color in the context bar
- **Fragments**: select an element → "fragment" checkbox (+ optional
  explicit order) to make it appear step-by-step
- **Layers**: bring to front / send to back
- **Save**: Ctrl+S or the Save button; optional autosave toggle
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z, ~100 steps
- **Copy/paste/duplicate elements**: Ctrl+C / Ctrl+V / Ctrl+D

## File conventions (what the editor writes)

Everything is standard reveal.js except one convention: positioned elements
carry `class="re-el"` and a self-sufficient inline style
(`position:absolute; left/top/width` in the 960×700 canvas space). Slides
created by the editor get `class="re-slide"`. Fragments, backgrounds, code
and math all use stock reveal markup (`class="fragment"`,
`data-background-color`, `<pre><code class="language-julia">`, KaTeX
delimiters), so the files stay obvious to hand-edit and other reveal decks
open fine (their elements become draggable the first time you move them).

Saved files always contain raw LaTeX and raw code source — never rendered
KaTeX markup or highlight spans.

## Maintenance

- `npm test` — round-trip/idempotency suite + server e2e (31+ tests)
- `npm run vendor` — refresh `templates/reveal-dist/` after bumping the
  reveal.js/katex versions in package.json
- `npm run build` — rebuild the editor UI into `dist/` after changing
  `src/client/` (commit the result so clones stay build-free)

## Limitations (v1)

- Horizontal slides only in the sidebar; vertical stacks render but aren't
  managed visually
- One deck per editor instance; localhost only (that's the security model)
- Speaker-notes editing, themes, and PDF export: use reveal's own
  facilities (`?print-pdf`, editing the theme `<link>` by hand)
- Markdown-source decks (`data-markdown`) are not supported: reveal replaces
  the markdown source with rendered HTML at load time, so the editor refuses
  to open them rather than overwrite the source with that HTML on save
