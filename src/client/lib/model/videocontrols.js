// Control bar for cropped videos. A browser draws native controls along the
// bottom edge of the <video> box itself, which a crop frame clips away as
// soon as the picture is offset or zoomed, and their position cannot be
// moved. So a framed video hands its controls over: the marker attribute
// below replaces `controls` for as long as the video sits in a frame
// (crop.js swaps the two when wrapping and unwrapping), and this runtime
// builds a bar anchored to the frame's bottom edge instead.
//
// The bar itself is never saved: it is built from the marker at load time,
// carries `re-transient` so the save cleaner drops it, and is rebuilt
// whenever the slides change.

export const VIDEO_CONTROLS_ATTR = 'data-re-controls'

export const VIDEO_CONTROLS_CLASS = 're-video-controls'

const SCRIPT_ID = 're-video-controls-runtime'

export const VIDEO_CONTROLS_CSS = `
.reveal .re-image-frame > .re-video-controls {
  position: absolute; left: 0; bottom: 0; width: 100%; z-index: 2;
  display: flex; align-items: center; gap: 8px; padding: 0 8px;
  height: 32px; box-sizing: border-box;
  background: rgba(16, 17, 22, .62); color: #fff;
  font: 12px/1 system-ui, -apple-system, Segoe UI, sans-serif;
  opacity: 0; pointer-events: none; transition: opacity .2s ease;
}
/* The runtime shows the bar while the video is paused, while the pointer is
   live over the frame, and while focus is inside it. Hidden, it must not
   swallow a click meant for the slide underneath. */
.reveal .re-image-frame > .re-video-controls[data-show],
.reveal .re-image-frame > .re-video-controls:focus-within {
  opacity: 1; pointer-events: auto;
}
.reveal .re-image-frame[data-re-idle] { cursor: none; }
.reveal .re-video-controls button {
  background: none; border: 0; margin: 0; padding: 2px; color: inherit;
  font: inherit; line-height: 0; cursor: pointer; border-radius: 3px;
}
.reveal .re-video-controls button:hover { background: rgba(255, 255, 255, .18); }
.reveal .re-video-controls input[type="range"] {
  flex: 1; min-width: 0; height: 3px; margin: 0; accent-color: #fff; cursor: pointer;
}
.reveal .re-video-controls .re-vc-time {
  font-variant-numeric: tabular-nums; white-space: nowrap; opacity: .85;
}
`.trim()

// Self-contained: this source runs both from the saved deck's runtime script
// and, injected by installVideoControls, inside the editor's deck frame.
// Repeated runs replace the previous observer rather than stacking one up.
export const VIDEO_CONTROLS_SCRIPT = `(() => {
  const ATTR = 'data-re-controls';
  const CLASS = 're-video-controls';
  const icon = (body) => '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' + body + '</svg>';
  const PLAY = icon('<path fill="currentColor" d="M8 5v14l11-7z"/>');
  const PAUSE = icon('<path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"/>');
  const SOUND = icon('<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/>');
  const MUTED = icon('<path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/>' +
    '<path stroke="currentColor" stroke-width="2" fill="none" d="M16.5 9.5l5 5m0-5l-5 5"/>');
  const clock = (s) => {
    const whole = Math.max(0, Math.floor(s || 0));
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  };
  // how long the bar survives an idle pointer over a playing video
  const IDLE_MS = 2500;
  // below this the bar cannot hold its buttons, so it spans the frame instead
  const MIN_WIDTH = 80;
  const px = (el, prop, fallback) => {
    const value = parseFloat(el.style[prop]);
    return isFinite(value) ? value : fallback;
  };

  // The bar tracks the picture the frame actually shows, not the frame: the
  // video's box inside the frame, shrunk to the letterbox a mismatched aspect
  // ratio leaves (a video's default object-fit is contain), then clipped to
  // the frame.
  const visibleRect = (frame, video) => {
    const fw = px(frame, 'width', frame.offsetWidth);
    const fh = px(frame, 'height', frame.offsetHeight);
    let left = px(video, 'left', video.offsetLeft);
    let top = px(video, 'top', video.offsetTop);
    let width = px(video, 'width', video.offsetWidth);
    let height = px(video, 'height', video.offsetHeight);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0 && width > 0 && height > 0) {
      const scale = Math.min(width / vw, height / vh);
      left += (width - vw * scale) / 2;
      top += (height - vh * scale) / 2;
      width = vw * scale;
      height = vh * scale;
    }
    const visible = Math.min(fw, left + width) - Math.max(0, left);
    const bottom = Math.min(fh, top + height);
    // too little of the picture is in view to carry the controls: the frame
    // keeps them usable
    if (!(visible >= MIN_WIDTH) || !(bottom > 0)) return { left: 0, width: fw, bottom: fh };
    return { left: Math.max(0, left), width: visible, bottom };
  };

  const build = (frame, video) => {
    const doc = frame.ownerDocument;
    const bar = doc.createElement('div');
    bar.className = 're-transient ' + CLASS;
    const play = doc.createElement('button');
    play.type = 'button';
    const seek = doc.createElement('input');
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

    // A drag holds the slider still until it is released, so the running
    // timeupdate cannot yank the thumb out from under the pointer.
    let scrubbing = false;
    let paused = null;
    let muted = null;
    // Every write is guarded on a real change: the observer below watches
    // this subtree, and a rewrite that changes nothing would wake it forever.
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
    };

    const place = () => {
      const rect = visibleRect(frame, video);
      const set = (prop, value) => { if (bar.style[prop] !== value) bar.style[prop] = value; };
      set('left', rect.left + 'px');
      set('width', rect.width + 'px');
      set('bottom', (px(frame, 'height', frame.offsetHeight) - rect.bottom) + 'px');
    };

    let idle = null;
    const hide = () => {
      if (idle !== null) { clearTimeout(idle); idle = null; }
      // a paused video keeps its controls; only playback takes them away
      if (video.paused) return;
      bar.removeAttribute('data-show');
      frame.setAttribute('data-re-idle', '');
    };
    const show = () => {
      if (idle !== null) clearTimeout(idle);
      idle = video.paused ? null : setTimeout(hide, IDLE_MS);
      if (!bar.hasAttribute('data-show')) bar.setAttribute('data-show', '');
      frame.removeAttribute('data-re-idle');
    };

    play.addEventListener('click', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    mute.addEventListener('click', () => { video.muted = !video.muted; });
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    seek.addEventListener('pointerup', () => { scrubbing = false; });
    seek.addEventListener('input', () => {
      const value = Number(seek.value);
      if (isFinite(value)) video.currentTime = value;
    });
    bar.addEventListener('focusin', show);
    bar.addEventListener('focusout', hide);
    frame.addEventListener('pointermove', show);
    frame.addEventListener('pointerleave', hide);
    const onState = () => { paint(); show(); };
    const onMeta = () => { paint(); place(); };
    for (const type of ['play', 'pause', 'ended', 'volumechange']) video.addEventListener(type, onState);
    for (const type of ['timeupdate', 'durationchange']) video.addEventListener(type, paint);
    video.addEventListener('loadedmetadata', onMeta);
    // the scaled canvas gives the bar new pixel geometry with every resize
    const win = doc.defaultView;
    win.addEventListener('resize', place);

    bar.reTeardown = () => {
      if (idle !== null) clearTimeout(idle);
      frame.removeEventListener('pointermove', show);
      frame.removeEventListener('pointerleave', hide);
      for (const type of ['play', 'pause', 'ended', 'volumechange']) video.removeEventListener(type, onState);
      for (const type of ['timeupdate', 'durationchange']) video.removeEventListener(type, paint);
      video.removeEventListener('loadedmetadata', onMeta);
      win.removeEventListener('resize', place);
      frame.removeAttribute('data-re-idle');
    };
    bar.rePlace = place;

    paint();
    show();
    frame.appendChild(bar);
    place();
  };

  // Idempotent: a run that finds every frame already served makes no DOM
  // change, so the observer that scheduled it does not fire again.
  const sync = () => {
    for (const bar of document.querySelectorAll('.' + CLASS)) {
      const video = bar.parentElement && bar.parentElement.querySelector(':scope > video[' + ATTR + ']');
      // a bar this run did not build — an older deck's runtime — is dropped
      // here and rebuilt below, so every bar on the page is this one's
      if (video && bar.rePlace) bar.rePlace();
      else {
        if (bar.reTeardown) bar.reTeardown();
        bar.remove();
      }
    }
    for (const video of document.querySelectorAll('.re-image-frame > video[' + ATTR + ']')) {
      const frame = video.parentElement;
      if (!frame.querySelector(':scope > .' + CLASS)) build(frame, video);
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
    if (window.__reVideoControls) window.__reVideoControls.observer.disconnect();
    const observer = new MutationObserver(schedule);
    // a resize or an adjusted crop moves the picture through inline styles
    observer.observe(slides, { childList: true, subtree: true, attributeFilter: [ATTR, 'style'] });
    window.__reVideoControls = { sync, observer };
    sync();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
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
