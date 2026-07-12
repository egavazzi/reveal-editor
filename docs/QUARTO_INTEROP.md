# Quarto interoperability

Use Quarto when a presentation is driven by executable analysis, citations,
cross-references, or generated tables. Use reveal-editor when visual placement
and direct control of the final browser document matter more.

## Reproducible assets without a generated presentation

A useful middle ground is to keep analysis in Julia, Python, or R and export
only its artifacts into the deck's `assets/` directory. Reference stable file
names from the HTML deck, for example:

```julia
savefig("talk/assets/model-comparison.svg")
```

```html
<img src="assets/model-comparison.svg" alt="Model comparison">
```

Re-running the analysis updates the figure while the slide layout remains
owned by reveal-editor. Prefer SVG for plots and diagrams, PNG/WebP for raster
images, and HTML blocks for genuinely interactive browser output.

## One-way eject from Quarto

When content is stable but a Quarto deck needs final visual composition:

```sh
quarto render talk.qmd
reveal-editor eject talk.html polished-talk
```

The command copies the rendered HTML and locally referenced assets into
`polished-talk/`, renames the entry point to `deck.html`, and creates an
`EJECTED_FROM_QUARTO.md` warning. The new folder is independent: rendering the
QMD again will not update it, and changes made in reveal-editor do not flow
back to QMD.

Commit either the QMD workflow or the ejected deck as the authoritative final
presentation. Do not silently maintain both as competing sources of truth.

## Copying individual Quarto output

For a single diagram, table, or widget, prefer exporting or copying that
artifact into `assets/` and inserting it into an HTML or custom-HTML block.
This keeps the boundary explicit and avoids importing Quarto's generated slide
scaffolding for one element.

