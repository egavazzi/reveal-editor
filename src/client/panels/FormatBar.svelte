<script>
  import { editor } from '../stores/editor.svelte.js'
  import {
    applyFormat, setFontSize, setTextColor,
    toggleFragment, setFragmentIndex, bringToFront, sendToBack,
    slideBackground, selectionInfo, arrangeSelection
  } from '../lib/actions.js'

  // Prevent toolbar clicks from stealing focus/selection from the
  // contenteditable element inside the iframe.
  function keepFocus(e) {
    e.preventDefault()
  }

  const info = $derived.by(() => {
    void editor.selectionCount
    void editor.selectionVersion
    void editor.docVersion
    return selectionInfo()
  })
</script>

{#if editor.ready}
  <div class="formatbar" role="toolbar" tabindex="-1" onmousedown={keepFocus}>
    {#if editor.textEditing}
      <button title="Bold (Ctrl+B)" onclick={() => applyFormat('bold')}><b>B</b></button>
      <button title="Italic (Ctrl+I)" onclick={() => applyFormat('italic')}><i>I</i></button>
      <button title="Underline (Ctrl+U)" onclick={() => applyFormat('underline')}><u>U</u></button>
      <button title="Bullet list" onclick={() => applyFormat('insertUnorderedList')}>•≡</button>
      <button title="Numbered list" onclick={() => applyFormat('insertOrderedList')}>1≡</button>
      <button title="Clear formatting" onclick={() => applyFormat('removeFormat')}>⌫fmt</button>
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
          onchange={(e) => setFontSize(Number(e.currentTarget.value))}
        />
      </label>
      <label>
        color
        <input type="color" onchange={(e) => setTextColor(e.currentTarget.value)} />
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
      <button title="Bring to front" onclick={bringToFront}>⬆ front</button>
      <button title="Send to back" onclick={sendToBack}>⬇ back</button>
      {#if editor.selectionCount > 1}
        <span class="sep"></span>
        <button title="Align left" onclick={() => arrangeSelection('left')}>⇤</button>
        <button title="Align horizontal centers" onclick={() => arrangeSelection('center')}>↔</button>
        <button title="Align right" onclick={() => arrangeSelection('right')}>⇥</button>
        <button title="Align top" onclick={() => arrangeSelection('top')}>⤒</button>
        <button title="Align vertical centers" onclick={() => arrangeSelection('middle')}>↕</button>
        <button title="Align bottom" onclick={() => arrangeSelection('bottom')}>⤓</button>
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
    {/if}
  </div>
{/if}

<style>
  .formatbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: #2b2c33;
    border-bottom: 1px solid #131418;
    min-height: 26px;
  }
  button {
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 6px;
    padding: 2px 10px;
    cursor: pointer;
    font-size: 13px;
  }
  button:hover {
    background: #3f4049;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: #45464f;
    margin: 0 6px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #9a9ba3;
    font-size: 12px;
  }
  label.check {
    cursor: pointer;
  }
  input[type='number'] {
    width: 60px;
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 4px;
    padding: 2px 6px;
  }
  input[type='color'] {
    width: 32px;
    height: 24px;
    padding: 0;
    border: 1px solid #45464f;
    border-radius: 4px;
    background: #34353d;
  }
</style>
