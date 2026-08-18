<script>
  import { editor, runtime } from '../stores/editor.svelte.js'
  import {
    applyFormat, setFontSize, setTextColor,
    toggleFragment, setFragmentIndex, bringToFront, sendToBack,
    currentSlideTransition, setCurrentSlideTransition,
    slideBackground, selectionInfo, arrangeSelection, groupSelection, ungroupSelection,
    currentFontSize
  } from '../lib/actions.js'
  import { queryFormatState, saveTextSelection, applyLink } from '../lib/editors/text.js'
  import { icon } from '../lib/icons.js'

  // Prevent toolbar clicks from stealing focus/selection from the
  // contenteditable element inside the iframe. Inputs opt out via stopFocus.
  function keepFocus(e) {
    e.preventDefault()
  }
  function stopFocus(e) {
    e.stopPropagation()
  }

  const info = $derived.by(() => {
    void editor.selectionCount
    void editor.selectionVersion
    void editor.docVersion
    return selectionInfo()
  })
  const slideTransition = $derived.by(() => {
    void editor.slideIndex.h
    void editor.slideIndex.v
    void editor.docVersion
    return currentSlideTransition()
  })

  // Live formatting state at the caret, for button highlighting.
  let fmt = $state(null)
  $effect(() => {
    if (!editor.textEditing || !runtime.bridge) {
      fmt = null
      return
    }
    const doc = runtime.bridge.doc
    const update = () => {
      fmt = queryFormatState()
    }
    update()
    doc.addEventListener('selectionchange', update)
    return () => doc.removeEventListener('selectionchange', update)
  })

  function setBlock(value) {
    applyFormat('formatBlock', `<${value}>`)
    fmt = queryFormatState() ?? fmt
  }

  // Link editing: remember the text selection before the URL input takes focus.
  let linkOpen = $state(false)
  let linkUrl = $state('')
  let savedRange = null
  function toggleLink() {
    if (fmt?.link) {
      applyFormat('unlink')
      return
    }
    savedRange = saveTextSelection()
    linkUrl = ''
    linkOpen = !linkOpen
  }
  // Effective size shown in the px box: caret context while editing text,
  // otherwise the first selected element.
  const sizeValue = $derived.by(() => {
    void editor.selectionCount
    void editor.selectionVersion
    void editor.docVersion
    if (editor.textEditing) return fmt?.fontSize ?? null
    return currentFontSize()
  })

  function commitLink() {
    linkOpen = false
    applyLink(linkUrl, savedRange)
    savedRange = null
    runtime.overlay?.refresh()
  }
</script>

{#if editor.ready}
  <div class="formatbar" role="toolbar" tabindex="-1" data-keep-text-edit onmousedown={keepFocus}>
    {#if editor.textEditing}
      <select
        class="block"
        title="Paragraph style"
        value={fmt?.block ?? 'p'}
        onmousedown={stopFocus}
        onchange={(e) => setBlock(e.currentTarget.value)}
      >
        <option value="p">Normal</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="blockquote">Quote</option>
      </select>
      <span class="sep"></span>
      <button class:active={fmt?.bold} title="Bold (Ctrl+B)" onclick={() => applyFormat('bold')}><b>B</b></button>
      <button class:active={fmt?.italic} title="Italic (Ctrl+I)" onclick={() => applyFormat('italic')}><i>I</i></button>
      <button class:active={fmt?.underline} title="Underline (Ctrl+U)" onclick={() => applyFormat('underline')}><u>U</u></button>
      <button class:active={fmt?.strike} title="Strikethrough" onclick={() => applyFormat('strikeThrough')}><s>S</s></button>
      <button title="Clear formatting" onclick={() => applyFormat('removeFormat')}>{@html icon('clearFormat')}</button>
      <span class="sep"></span>
      <button class:active={fmt?.ul} title="Bullet list" onclick={() => applyFormat('insertUnorderedList')}>{@html icon('listUl')}</button>
      <button class:active={fmt?.ol} title="Numbered list" onclick={() => applyFormat('insertOrderedList')}>{@html icon('listOl')}</button>
      <span class="sep"></span>
      <button class:active={fmt?.align === 'left'} title="Align left" onclick={() => applyFormat('justifyLeft')}>{@html icon('alignLeft')}</button>
      <button class:active={fmt?.align === 'center'} title="Align center" onclick={() => applyFormat('justifyCenter')}>{@html icon('alignCenter')}</button>
      <button class:active={fmt?.align === 'right'} title="Align right" onclick={() => applyFormat('justifyRight')}>{@html icon('alignRight')}</button>
      <button class:active={fmt?.align === 'justify'} title="Justify" onclick={() => applyFormat('justifyFull')}>{@html icon('alignJustify')}</button>
      <span class="sep"></span>
      <button class:active={fmt?.link} title={fmt?.link ? 'Remove link' : 'Insert link'} onclick={toggleLink}>
        {@html icon(fmt?.link ? 'unlink' : 'link')}
      </button>
      {#if linkOpen}
        <input
          class="link-url"
          type="text"
          placeholder="https://… (Enter to apply)"
          bind:value={linkUrl}
          onmousedown={stopFocus}
          onkeydown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitLink()
            if (e.key === 'Escape') linkOpen = false
          }}
        />
        <button title="Apply link" onclick={commitLink}>ok</button>
      {/if}
      <span class="sep"></span>
    {/if}

    {#if editor.textEditing || editor.selectionCount > 0}
      <label>
        size
        <input
          type="number"
          min="8"
          max="200"
          placeholder="px"
          value={sizeValue ?? ''}
          onmousedown={stopFocus}
          onchange={(e) => {
            setFontSize(Number(e.currentTarget.value))
            if (editor.textEditing) fmt = queryFormatState() ?? fmt
          }}
        />
      </label>
      <label>
        color
        <input type="color" onmousedown={stopFocus} onchange={(e) => setTextColor(e.currentTarget.value)} />
      </label>
    {/if}

    {#if editor.selectionCount > 0 && !editor.textEditing}
      <span class="sep"></span>
      <label class="check">
        <input type="checkbox" checked={info.isFragment} onchange={toggleFragment} />
        fragment
      </label>
      {#if info.isFragment}
        <label>
          order
          <input
            type="number"
            min="0"
            placeholder="auto"
            value={info.fragmentIndex}
            onchange={(e) =>
              setFragmentIndex(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
          />
        </label>
      {/if}
      <span class="sep"></span>
      <button title="Bring to front" onclick={bringToFront}>{@html icon('front')} front</button>
      <button title="Send to back" onclick={sendToBack}>{@html icon('back')} back</button>
      {#if editor.selectionCount > 1}
        <span class="sep"></span>
        <button title="Align left" onclick={() => arrangeSelection('left')}>⇤</button>
        <button title="Align horizontal centers" onclick={() => arrangeSelection('center')}>↔</button>
        <button title="Align right" onclick={() => arrangeSelection('right')}>⇥</button>
        <button title="Align top" onclick={() => arrangeSelection('top')}>⤒</button>
        <button title="Align vertical centers" onclick={() => arrangeSelection('middle')}>↕</button>
        <button title="Align bottom" onclick={() => arrangeSelection('bottom')}>⤓</button>
        <button title="Group selected elements" onclick={groupSelection}>{@html icon('group')} group</button>
      {/if}
      {#if editor.selectionCount === 1 && editor.selectionTag === 'div'}
        <button title="Ungroup selected group" onclick={ungroupSelection}>ungroup</button>
      {/if}
      {#if editor.selectionCount > 2}
        <button title="Distribute horizontally" onclick={() => arrangeSelection('distribute-horizontal')}>⇹</button>
        <button title="Distribute vertically" onclick={() => arrangeSelection('distribute-vertical')}>⇳</button>
      {/if}
    {/if}

    {#if editor.selectionCount === 0 && !editor.textEditing}
      <label>
        slide background
        <input type="color" onchange={(e) => slideBackground(e.currentTarget.value)} />
      </label>
      <button title="Clear background" onclick={() => slideBackground('')}>clear</button>
      <label>
        slide transition
        <select value={slideTransition} onmousedown={stopFocus} onchange={(e) => setCurrentSlideTransition(e.currentTarget.value)}>
          <option value="">Deck default</option><option value="none">None</option><option value="fade">Fade</option>
          <option value="slide">Slide</option><option value="convex">Convex</option><option value="concave">Concave</option>
          <option value="zoom">Zoom</option>
        </select>
      </label>
    {/if}
  </div>
{/if}

<style>
  .formatbar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 5px 14px;
    background: var(--ui-surface);
    border-bottom: 1px solid var(--ui-border-strong);
    min-height: 28px;
    flex-wrap: wrap;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 28px;
    height: 26px;
    box-sizing: border-box;
    background: transparent;
    color: var(--ui-text);
    border: none;
    border-radius: var(--ui-radius);
    padding: 3px 7px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
  }
  button:hover {
    background: var(--ui-control-hover);
  }
  button.active {
    background: var(--ui-primary);
    color: #fff;
  }
  .formatbar :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
    flex: none;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--ui-border);
    margin: 0 5px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ui-muted);
    font-size: 12px;
  }
  label.check {
    cursor: pointer;
  }
  input[type='number'] {
    width: 56px;
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 3px 6px;
  }
  input[type='color'] {
    width: 32px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    background: var(--ui-control);
  }
  select {
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 3px 5px;
    font-family: inherit;
  }
  select.block {
    min-width: 96px;
  }
  .link-url {
    width: 200px;
    background: var(--ui-control);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
  }
  input[type='checkbox'] {
    accent-color: var(--ui-primary);
  }
</style>
