<script>
  import { editor } from '../stores/editor.svelte.js'
  import { updatePopover, closePopover } from '../lib/actions.js'

  const title = $derived(editor.popover?.type === 'math' ? 'LaTeX' : 'Code')

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePopover(false)
    }
    e.stopPropagation()
  }
</script>

{#if editor.popover}
  <div class="popover" role="dialog" aria-label="{title} editor">
    <div class="head">
      <span class="title">{title}</span>
      {#if editor.popover.type === 'code'}
        <label>
          language
          <input
            class="lang"
            value={editor.popover.lang}
            oninput={(e) => updatePopover(editor.popover.value, e.currentTarget.value)}
          />
        </label>
      {:else}
        <span class="hint">inline: \( … \) display: $$ … $$</span>
      {/if}
      <span class="spacer"></span>
      <button onclick={() => closePopover(false)}>Cancel</button>
      <button class="primary" onclick={() => closePopover(true)}>Done</button>
    </div>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      autofocus
      spellcheck="false"
      value={editor.popover.value}
      oninput={(e) => updatePopover(e.currentTarget.value)}
      onkeydown={onKeydown}
    ></textarea>
    <div class="foot">changes preview live on the slide</div>
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    left: 50%;
    bottom: 40px;
    transform: translateX(-50%);
    width: min(720px, 90vw);
    background: #26272e;
    border: 1px solid #45464f;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    z-index: 50;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #131418;
  }
  .title {
    font-weight: 600;
    color: #8ab4ff;
  }
  .hint {
    color: #9a9ba3;
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #9a9ba3;
    font-size: 12px;
  }
  .lang {
    width: 90px;
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 4px;
    padding: 2px 6px;
  }
  textarea {
    height: 160px;
    resize: vertical;
    background: #1b1c21;
    color: #e6e7ec;
    border: none;
    padding: 10px 12px;
    font-family: ui-monospace, 'JuliaMono', monospace;
    font-size: 14px;
    line-height: 1.45;
    outline: none;
  }
  .foot {
    padding: 4px 12px 8px;
    color: #6f7077;
    font-size: 11px;
  }
  button {
    background: #34353d;
    color: #d6d7dc;
    border: 1px solid #45464f;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
  }
  button.primary {
    background: #2f6fba;
    border-color: #2f6fba;
    color: #fff;
  }
</style>
