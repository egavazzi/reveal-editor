// Video controls. `data-re-controls` is how a deck records "this video has
// controls": a <video> the editor has touched never carries the browser's own
// `controls` attribute, and the runtime below draws the bar instead. Native
// controls are drawn on the bottom edge of the <video> box and cannot be
// moved, so a crop frame clips them away as soon as the picture is offset or
// zoomed, and a letterboxed video puts them in the black band rather than on
// the picture. One bar, positioned on the picture itself, covers both.
//
// A video that arrives with native `controls` — a foreign deck, a
// hand-written one — is migrated to the marker the first time the runtime
// syncs, so every deck the editor writes is consistent.
//
// The bar itself is never saved: the runtime builds it from the marker as the
// video's next sibling, it carries `re-transient` so the save cleaner drops
// it, and it is rebuilt whenever the slides change.

export const VIDEO_CONTROLS_ATTR = 'data-re-controls'

// Seconds between a slide appearing and its video starting. reveal.js starts
// a `data-autoplay` video the moment the slide opens, so a delayed video
// carries this attribute *instead* of `data-autoplay`: the runtime below owns
// its start.
export const VIDEO_DELAY_ATTR = 'data-re-autoplay-delay'

export const VIDEO_CONTROLS_CLASS = 're-video-controls'

const SCRIPT_ID = 're-video-controls-runtime'

// The bar's own height and its inset from the picture's edges, shared by the
// stylesheet and the runtime that positions it.
const BAR_HEIGHT = 28
const INSET = 12

export const VIDEO_CONTROLS_CSS = `
.reveal .re-video-controls {
  position: absolute; box-sizing: border-box;
  height: ${BAR_HEIGHT}px; padding: 0 ${INSET}px;
  display: flex; align-items: center; gap: 10px;
  color: #fff; font: 13px/1 system-ui, -apple-system, Segoe UI, sans-serif;
  /* The bar never paints a background over the picture, so legibility rests
     on two shadows: a tight dark halo that holds the glyph edges against
     bright footage, and a soft one that gives depth on dark footage. */
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, .9)) drop-shadow(0 1px 3px rgba(0, 0, 0, .7));
  opacity: 0; pointer-events: none; transition: opacity .15s ease;
}
/* the bar shows while the pointer is over the picture or the bar, and
   nowhere else — a button keeping focus must not pin it open */
.reveal .re-video-controls[data-show] { opacity: 1; pointer-events: auto; }
.reveal .re-video-controls button {
  background: none; border: 0; margin: 0; padding: 0; color: inherit;
  line-height: 0; cursor: pointer; opacity: .85; transition: opacity .15s ease;
}
.reveal .re-video-controls button:hover { opacity: 1; }
.reveal .re-video-controls .re-vc-seek {
  flex: 1; min-width: 0; height: 12px; margin: 0; padding: 0; cursor: pointer;
  -webkit-appearance: none; appearance: none; background: none;
}
/* The played part is drawn into the track, so it reads the same everywhere;
   the dark ring keeps the thin white line visible on bright footage. */
.reveal .re-video-controls .re-vc-seek::-webkit-slider-runnable-track {
  height: 2px; border-radius: 2px;
  background: var(--re-vc-track, rgba(255, 255, 255, .45));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .5);
}
.reveal .re-video-controls .re-vc-seek::-moz-range-track {
  height: 2px; border-radius: 2px;
  background: var(--re-vc-track, rgba(255, 255, 255, .45));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .5);
}
.reveal .re-video-controls .re-vc-seek:hover::-webkit-slider-runnable-track { height: 3px; }
.reveal .re-video-controls .re-vc-seek:hover::-moz-range-track { height: 3px; }
.reveal .re-video-controls .re-vc-seek::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; margin-top: -4px;
  border: 0; border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .5);
  opacity: 0; transition: opacity .15s ease;
}
.reveal .re-video-controls .re-vc-seek::-moz-range-thumb {
  width: 10px; height: 10px; border: 0; border-radius: 50%; background: #fff;
  opacity: 0; transition: opacity .15s ease;
}
.reveal .re-video-controls .re-vc-seek:hover::-webkit-slider-thumb { opacity: 1; }
.reveal .re-video-controls .re-vc-seek:hover::-moz-range-thumb { opacity: 1; }
.reveal .re-video-controls .re-vc-time {
  font-variant-numeric: tabular-nums; white-space: nowrap; opacity: .9;
}
.reveal [data-re-idle] { cursor: none; }
`.trim()

// Self-contained: this source runs both from the saved deck's runtime script
// and, injected by installVideoControls, inside the editor's deck frame.
// Repeated runs replace the previous observer rather than stacking one up.
export const VIDEO_CONTROLS_SCRIPT = `(() => {
  const ATTR = '${VIDEO_CONTROLS_ATTR}';
  const CLASS = '${VIDEO_CONTROLS_CLASS}';
  const BAR_H = ${BAR_HEIGHT};
  const INSET = ${INSET};
  // how long the bar survives a pointer resting over a playing video
  const IDLE_MS = 2500;
  // below this the bar cannot hold its controls, so it takes the whole picture
  const MIN_WIDTH = 80;
  const SCOPE = '.reveal .slides ';
  // every bar carries the token of the run that built it, so a later run —
  // the editor's copy over the deck file's — can tell its own from the rest
  const OWNER = {};

  const icon = (body) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + body + '</svg>';
  const PLAY = icon('<path d="M8 5.5l10 6.5-10 6.5z"/>');
  const PAUSE = icon('<path d="M9 5.5v13M15 5.5v13"/>');
  const SPEAKER = '<path d="M4.5 9.5h3l4.5-3.5v12L7.5 14.5h-3z"/>';
  const SOUND = icon(SPEAKER + '<path d="M15.5 9.8a3.5 3.5 0 010 4.4"/>' +
    '<path d="M18 7.6a7 7 0 010 8.8"/>');
  const MUTED = icon(SPEAKER + '<path d="M16 10l4.5 4.5M20.5 10L16 14.5"/>');

  const clock = (s) => {
    const whole = Math.max(0, Math.floor(s || 0));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  };
  const px = (el, prop, fallback) => {
    const value = parseFloat(el.style[prop]);
    return isFinite(value) ? value : fallback;
  };
  const frameOf = (video) => {
    const parent = video.parentElement;
    return parent && parent.classList.contains('re-image-frame') ? parent : null;
  };

  // Hover is decided from the pointer's position against the picture and the
  // bar together, not from enter/leave events: the bar overlaps the picture
  // it belongs to, so crossing between them fires leave events that mean
  // nothing, and a pointer that leaves through the bar fires none at all.
  const entries = new Set();
  const over = (el, x, y) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const onPointerMove = (e) => {
    for (const entry of entries) entry.hover(e.clientX, e.clientY);
  };
  // Only the document's own pointerleave means the pointer has left the page.
  // pointerleave does not bubble, but it is still dispatched down to every
  // ancestor in the capture phase, and the picture fires one the instant the
  // bar appears under the pointer and takes the hover from it.
  const onPointerOut = (e) => {
    if (e.target !== document && e.target !== document.documentElement) return;
    for (const entry of entries) entry.hide();
  };

  // Where the picture actually shows, in the coordinates the bar is
  // positioned in (its parent's): the video's own box, shrunk to the
  // letterbox a mismatched aspect ratio leaves — a video's default object-fit
  // is contain — and clipped to the frame when there is one.
  const visibleRect = (video) => {
    const frame = frameOf(video);
    let left = px(video, 'left', video.offsetLeft);
    let top = px(video, 'top', video.offsetTop);
    let width = px(video, 'width', video.offsetWidth);
    let height = px(video, 'height', video.offsetHeight);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = { left: left, width: width, bottom: top + height };
    if (vw > 0 && vh > 0 && width > 0 && height > 0) {
      const scale = Math.min(width / vw, height / vh);
      left += (width - vw * scale) / 2;
      top += (height - vh * scale) / 2;
      width = vw * scale;
      height = vh * scale;
    }
    if (!frame) {
      return width >= MIN_WIDTH ? { left: left, width: width, bottom: top + height } : box;
    }
    const fw = px(frame, 'width', frame.offsetWidth);
    const fh = px(frame, 'height', frame.offsetHeight);
    const visible = Math.min(fw, left + width) - Math.max(0, left);
    const bottom = Math.min(fh, top + height);
    // too little of the picture is in view to carry the controls: the frame
    // keeps them usable
    if (!(visible >= MIN_WIDTH) || !(bottom > 0)) return { left: 0, width: fw, bottom: fh };
    return { left: Math.max(0, left), width: visible, bottom: bottom };
  };

  const build = (video) => {
    const doc = video.ownerDocument;
    const bar = doc.createElement('div');
    bar.className = 're-transient ' + CLASS;
    const play = doc.createElement('button');
    play.type = 'button';
    const seek = doc.createElement('input');
    seek.className = 're-vc-seek';
    seek.type = 'range';
    seek.min = '0';
    seek.step = '0.05';
    seek.value = '0';
    seek.setAttribute('aria-label', 'Seek');
    const time = doc.createElement('span');
    time.className = 're-vc-time';
    time.appendChild(doc.createTextNode(''));
    const mute = doc.createElement('button');
    mute.type = 'button';
    bar.append(play, seek, time, mute);
    // the pointer is tracked over what the viewer sees: the frame's window on
    // the picture, or the video itself when nothing crops it
    const host = frameOf(video) || video;

    // A drag holds the slider still until it is released, so the running
    // timeupdate cannot yank the thumb out from under the pointer.
    let scrubbing = false;
    let paused = null;
    let muted = null;
    // Every write is guarded on a real change: a rewrite that changes nothing
    // still wakes the observer below.
    const paint = () => {
      if (paused !== video.paused) {
        paused = video.paused;
        play.innerHTML = paused ? PLAY : PAUSE;
        play.title = paused ? 'Play' : 'Pause';
      }
      if (muted !== video.muted) {
        muted = video.muted;
        mute.innerHTML = muted ? MUTED : SOUND;
        mute.title = muted ? 'Unmute' : 'Mute';
      }
      const duration = isFinite(video.duration) ? video.duration : 0;
      seek.max = String(duration);
      if (!scrubbing) seek.value = String(video.currentTime || 0);
      const label = clock(video.currentTime) + ' / ' + clock(duration);
      if (time.firstChild.data !== label) time.firstChild.data = label;
      const done = duration > 0 ? Math.min(100, (video.currentTime || 0) / duration * 100) : 0;
      const stop = done.toFixed(2) + '%';
      const track = 'linear-gradient(to right, #fff 0, #fff ' + stop +
        ', rgba(255,255,255,.45) ' + stop + ', rgba(255,255,255,.45) 100%)';
      if (seek.style.getPropertyValue('--re-vc-track') !== track) {
        seek.style.setProperty('--re-vc-track', track);
      }
    };

    const place = () => {
      const rect = visibleRect(video);
      const frame = frameOf(video);
      let top = rect.bottom - BAR_H - INSET;
      // inside a frame the bar has nowhere to go but the visible window
      if (frame) top = Math.max(0, top);
      const set = (prop, value) => { if (bar.style[prop] !== value) bar.style[prop] = value; };
      set('left', rect.left + 'px');
      set('width', rect.width + 'px');
      set('top', top + 'px');
      // a sibling bar shares the video's stacking level and, being later in
      // the document, paints over it
      set('zIndex', video.style.zIndex);
    };

    // The bar belongs to the pointer: it is out whenever the pointer is not
    // over the picture or the bar, whatever the video is doing.
    let idle = null;
    const hide = () => {
      if (idle !== null) { clearTimeout(idle); idle = null; }
      bar.removeAttribute('data-show');
      host.removeAttribute('data-re-idle');
    };
    // the pointer rested over running footage: take the cursor away with it
    const hideIdle = () => {
      idle = null;
      bar.removeAttribute('data-show');
      host.setAttribute('data-re-idle', '');
    };
    const show = () => {
      if (idle !== null) clearTimeout(idle);
      idle = video.paused ? null : setTimeout(hideIdle, IDLE_MS);
      if (!bar.hasAttribute('data-show')) bar.setAttribute('data-show', '');
      host.removeAttribute('data-re-idle');
    };
    const entry = {
      hover: (x, y) => { if (over(host, x, y) || over(bar, x, y)) show(); else hide(); },
      hide: hide
    };
    entries.add(entry);

    const toggle = () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    };
    // a pointer-driven press must not leave focus on the button: focus would
    // outlive the pointer, and the bar would have no reason left to hide
    const press = (button, action) => button.addEventListener('click', (e) => {
      action();
      if (e.detail > 0) button.blur();
    });
    press(play, toggle);
    press(mute, () => { video.muted = !video.muted; });

    // Clicking the picture plays or pauses it, as a player does. On the edit
    // canvas that belongs to the same Ctrl gate as the rest of playback:
    // without it a click selects and drags the element.
    let pressed = null;
    const onPress = (e) => { pressed = [e.clientX, e.clientY]; };
    const onClick = (e) => {
      const from = pressed;
      pressed = null;
      if (bar.contains(e.target) || host.classList.contains('re-cropping')) return;
      const body = doc.body;
      if (body.classList.contains('re-edit-mode') && !body.classList.contains('re-media-live')) return;
      // a click that ends a drag is not a click on the picture
      if (from && Math.abs(e.clientX - from[0]) + Math.abs(e.clientY - from[1]) > 4) return;
      toggle();
    };
    host.addEventListener('pointerdown', onPress);
    host.addEventListener('click', onClick);
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    seek.addEventListener('pointerup', () => { scrubbing = false; });
    seek.addEventListener('input', () => {
      const value = Number(seek.value);
      if (isFinite(value)) video.currentTime = value;
    });
    // starting or stopping playback changes what the countdown should do,
    // but only while the pointer is there to see the bar at all
    const onState = () => {
      paint();
      if (bar.hasAttribute('data-show')) show();
    };
    const onMeta = () => { paint(); place(); };
    for (const type of ['play', 'pause', 'ended', 'volumechange']) video.addEventListener(type, onState);
    for (const type of ['timeupdate', 'durationchange']) video.addEventListener(type, paint);
    video.addEventListener('loadedmetadata', onMeta);
    // the scaled canvas gives the bar new pixel geometry with every resize
    const win = doc.defaultView;
    win.addEventListener('resize', place);

    bar.reTeardown = () => {
      if (idle !== null) clearTimeout(idle);
      entries.delete(entry);
      host.removeEventListener('pointerdown', onPress);
      host.removeEventListener('click', onClick);
      for (const type of ['play', 'pause', 'ended', 'volumechange']) video.removeEventListener(type, onState);
      for (const type of ['timeupdate', 'durationchange']) video.removeEventListener(type, paint);
      video.removeEventListener('loadedmetadata', onMeta);
      win.removeEventListener('resize', place);
      host.removeAttribute('data-re-idle');
    };
    bar.rePlace = place;
    bar.reOwner = OWNER;

    paint();
    video.after(bar);
    place();
  };

  // Idempotent: a pass that finds every video already served changes nothing,
  // so the observer it would wake stays quiet.
  const sync = () => {
    for (const video of document.querySelectorAll(SCOPE + 'video[controls]')) {
      video.removeAttribute('controls');
      video.setAttribute(ATTR, '');
    }
    for (const bar of document.querySelectorAll(SCOPE + '.' + CLASS)) {
      const video = bar.previousElementSibling;
      const kept = video && video.tagName === 'VIDEO' && video.hasAttribute(ATTR);
      // a bar this run did not build — an older deck's runtime — is dropped
      // here and rebuilt below, so every bar on the page is this one's
      if (kept && bar.reOwner === OWNER) bar.rePlace();
      else {
        if (bar.reTeardown) bar.reTeardown();
        bar.remove();
      }
    }
    for (const video of document.querySelectorAll(SCOPE + 'video[' + ATTR + ']')) {
      const next = video.nextElementSibling;
      if (!(next && next.classList.contains(CLASS))) build(video);
    }
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  const start = () => {
    const slides = document.querySelector('.reveal .slides');
    if (!slides) return;
    const previous = window.__reVideoControls;
    if (previous) { previous.observer.disconnect(); previous.stop(); }
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerleave', onPointerOut, true);
    const stop = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerleave', onPointerOut, true);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target;
        const el = node.nodeType === 1 ? node : node.parentElement;
        // the bar's own repaints must not wake the pass that repaints it
        if (el && el.closest('.' + CLASS)) continue;
        schedule();
        return;
      }
    });
    // a move, a resize or an adjusted crop reaches the bar through inline styles
    observer.observe(slides, { childList: true, subtree: true, attributeFilter: [ATTR, 'controls', 'style'] });
    window.__reVideoControls = { sync: sync, observer: observer, stop: stop };
    sync();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();`

// Delayed autoplay, for the presented deck only: the edit canvas is not a
// presentation, and a slide opening there must not start playing. Ships in
// the deck's runtime script, which the editor never injects into its canvas.
export const VIDEO_AUTOPLAY_SCRIPT = `(() => {
  if (location.search.includes('editmode=1') || location.search.includes('print-pdf')) return;
  const ATTR = '${VIDEO_DELAY_ATTR}';
  let timers = [];
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };
  // The delay counts from the slide opening, and a video restarts on every
  // entry — the same contract reveal gives data-autoplay.
  const arm = () => {
    clear();
    const slide = Reveal.getCurrentSlide();
    if (!slide) return;
    for (const video of slide.querySelectorAll('video[' + ATTR + ']')) {
      const seconds = parseFloat(video.getAttribute(ATTR));
      if (!(seconds >= 0)) continue;
      video.pause();
      video.currentTime = 0;
      timers.push(setTimeout(() => {
        // a delay can outlast the slide it was armed on
        if (Reveal.getCurrentSlide() !== slide) return;
        const started = video.play();
        if (started && typeof started.catch === 'function') {
          started.catch((error) => {
            console.warn('reveal-editor: delayed autoplay was blocked', error);
          });
        }
      }, seconds * 1000));
    }
  };
  const install = () => {
    if (!window.Reveal || typeof Reveal.on !== 'function') return;
    Reveal.on('ready', arm);
    Reveal.on('slidechanged', arm);
    if (Reveal.isReady && Reveal.isReady()) arm();
  };
  addEventListener('load', () => setTimeout(install, 0), { once: true });
})();`

/**
 * Run the control-bar runtime in a document the editor drives, so the live
 * canvas gets the current build's bar whatever the deck file carries.
 */
export function installVideoControls(doc) {
  if (doc.getElementById(SCRIPT_ID)) return
  const script = doc.createElement('script')
  script.id = SCRIPT_ID
  script.textContent = VIDEO_CONTROLS_SCRIPT
  doc.head.appendChild(script)
}
