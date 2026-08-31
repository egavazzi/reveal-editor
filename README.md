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

### Optional: a global `reveal-editor` command

`npm run edit -- …` only works from inside this folder. To be able to type
`reveal-editor …` from anywhere, run once per machine, inside this folder:

```sh
npm link
```

This symlinks the command into npm's global bin directory. If typing
`reveal-editor` afterwards says "command not found", that directory is not
on your PATH — either add it, or link the command into a directory that is,
e.g.:

```sh
ln -s "$(npm prefix -g)/bin/reveal-editor" ~/.local/bin/
```

Then, from any directory:

```sh
reveal-editor new ~/talks/egu2026
reveal-editor ~/talks/egu2026

# one-way copy of rendered Quarto HTML for final visual polishing
reveal-editor eject talk.html ~/talks/polished-talk
```

## Usage

```sh
# create a new presentation (self-contained folder)
npm run edit -- new ~/talks/egu2026

# edit an existing one
npm run edit -- ~/talks/egu2026/deck.html

# eject rendered Quarto HTML into an independent deck
npm run edit -- eject talk.html ~/talks/polished-talk

# options: --port <n>, --no-open, --dev (editor UI from source)
```

The browser opens automatically. To **present**, just open `deck.html` in
any browser — each deck folder vendors its own pinned copy of reveal.js and
KaTeX (`reveal/`), so decks work offline, forever, with no dependency on
this editor.

See [Quarto interoperability](docs/QUARTO_INTEROP.md) for reproducible asset
workflows and the one-way eject tradeoff.

## Editing

- **Select**: click; shift-click or rubber-band for multi-select; Escape clears
- **Move/resize/rotate**: drag the handles; snapping to slide edges/centers
  and sibling elements; arrow keys nudge (Shift = 10 px)
- **Lines/arrows**: drag either endpoint handle to aim them; hold Shift to lock
  the angle to 15° steps, and a near-flat drag snaps level on its own (Ctrl
  drags freely). The Shape panel also has "Make horizontal"/"Make vertical",
  which straighten an existing line without changing its length or centre
- **Insert** (toolbar): text box, image (file picker, drop, or just Ctrl+V a
  screenshot), video (MP4/WebM picker or drop), rectangle/ellipse/line/arrow, LaTeX
  math (∑), code block (`{}`)
- **Text**: double-click to edit in place; bold/italic/underline/lists in
  the context bar; font size, color, and vertical alignment apply to the whole box
- **Math in text**: type LaTeX between delimiters anywhere in a text box —
  `$ … $` or `\( … \)` inline, `$$ … $$` display — and it renders when you
  finish editing. The ∑ button in the context bar wraps the selection for you.
  While a box is being edited it shows its LaTeX source rather than the
  rendered formula, so the caret never lands inside KaTeX markup
- **Math (standalone)**: the toolbar's ∑ inserts a formula box; double-click
  one → popover with raw LaTeX and live preview on the slide
- **Code**: double-click a code block → popover with raw source + language
  (Julia included), highlighted by the deck's own highlight.js
- **Slides**: sidebar thumbnails — click to jump, drag to reorder, buttons
  to add/duplicate/delete; slide background color in the context bar
- **Vertical stacks**: add vertical slides, navigate their numbered sidebar
  thumbnails, reorder within stacks, or promote/demote between horizontal and
  vertical structure
- **Fragments**: select an element → "fragment" checkbox (+ optional
  explicit order) to make it appear step-by-step
- **Layers**: open the Layers panel to select, reorder, show/hide, and
  lock/unlock objects; Ctrl-click adds to the selection and Shift-click picks
  a run, so several objects can be picked there and then grouped, aligned or
  moved together; quick bring-to-front/send-to-back buttons remain in the
  context bar
- **Inside groups**: a group unfolds into its members in the Layers panel —
  select a member, rename it, hide or lock it, or step it forward/backward
  within the group without taking it out
- **Composition**: align/distribute multi-selections, group/ungroup elements,
  edit exact geometry and rotation, lock resize aspect ratios (on by default
  for images and videos), and give layers accessible names
- **Layouts/templates**: create slides from built-in layouts or save the
  current slide as a reusable browser-local template
- **Images**: select an image to set exact dimensions, border, corner
  radius, shadow, and a presentation link; double-click (or use the Crop
  button) for PowerPoint-style cropping — drag the edge handles to crop,
  drag the picture to reposition it, drag its corners to zoom — and
  resizing a cropped image afterwards keeps the crop
- **Videos**: the Video panel scrubs and previews playback, sets exact
  dimensions and the saved autoplay/loop/muted/controls settings, and crops
  the video with the same edge/corner handles as an image. Videos with
  controls get a compact play/seek/mute bar drawn along the bottom of the
  picture — including a cropped or letterboxed one, where the browser's own
  player sits outside the visible picture — in the saved presentation as well
  as in the editor. The bar appears while the pointer is over the picture and
  clicking the picture plays or pauses it. Controls are recorded as
  `data-re-controls`, and a video
  that arrives with the native `controls` attribute is converted the first
  time the deck is opened
- **Deck setup**: the Deck panel controls the reveal theme, canvas format/size
  and margins, editor grid display/snapping, navigation-arrow visibility, and
  slide number format/position, typography, and transitions
- **Speaker notes**: the Notes panel writes native `<aside class="notes">`
  content for Reveal's speaker view
- **Custom HTML**: insert a trusted HTML/CSS/JS block with `</>`; scripts are
  preserved but intentionally execute only after opening the saved presentation
- **Present/PDF**: open the standalone deck, start it on the slide you are
  editing (▶| , which opens the deck at Reveal's `#/h/v` hash), or open
  Reveal's `?print-pdf` view — all from the toolbar. These open the deck file
  **on disk**, so save first to present unsaved edits
- **Save**: Ctrl+S or the Save button; optional autosave toggle
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z, ~100 steps
- **Copy/paste/duplicate elements**: Ctrl+C / Ctrl+V / Ctrl+D. Copied
  elements go on the system clipboard, so pasting an image or text copied
  in another application works too — text arrives as a new text box. A paste
  onto another slide keeps the coordinates it was copied from, so an element
  can hold the same spot across slides; pasting onto the slide it came from,
  or onto the same slide twice, steps each copy off the last one

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
KaTeX markup or highlight spans. Math delimiters normalize on save: whatever
you typed comes back as `\( … \)` inline and `$$ … $$` display.

## Maintenance

- `npm test` — round-trip/idempotency suite + server e2e (31+ tests)
- `npm run test:browser` — headless Firefox smoke test for live settings,
  save, and standalone reload (requires Firefox + GeckoDriver)
- `npm run vendor` — refresh `templates/reveal-dist/` after bumping the
  reveal.js/katex versions in package.json
- `npm run build` — rebuild the editor UI into `dist/` after changing
  `src/client/` (commit the result so clones stay build-free)

## Limitations (v1)

- One deck per editor instance; localhost only (that's the security model)
- Markdown-source decks (`data-markdown`) are not supported: reveal replaces
  the markdown source with rendered HTML at load time, so the editor refuses
  to open them rather than overwrite the source with that HTML on save
