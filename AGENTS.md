# Agent guidance

## Verify browser behavior in a real browser

For Reveal.js lifecycle, layout, CSS, or DOM behavior that a `happy-dom` test
cannot establish reliably, reproduce it in the installed headless Firefox
before inventing a workaround.

Available local tools:

- Firefox: `/usr/bin/firefox`
- GeckoDriver: `/snap/bin/geckodriver`

Recommended workflow:

1. Create an isolated deck fixture under `/tmp`.
2. Serve it over localhost with `python3 -m http.server`. Prefer HTTP because
   the snap-packaged Firefox may not see host `/tmp` paths through `file://`.
3. Start `geckodriver --port 4444` in a persistent terminal session.
4. Create a Firefox WebDriver session by posting headless capabilities to
   `http://127.0.0.1:4444/session`.
5. Navigate the returned session to the fixture URL.
6. Use WebDriver's `/execute/sync` endpoint to inspect the live DOM and runtime
   configuration. For Reveal issues, useful probes include
   `Reveal.isReady()`, `Reveal.getConfig()`, and the relevant element's
   `outerHTML`, `textContent`, inline style, and computed style.
7. Verify both initial configuration and post-initialization
   `Reveal.configure(...)` when the editor changes settings at runtime.
8. Turn the discovered failure into a focused automated regression test.
9. Delete the WebDriver session and stop both GeckoDriver and the temporary
   HTTP server when finished.

Localhost binding, browser launch, and WebDriver HTTP requests may require
sandbox escalation. Keep fixtures and generated screenshots outside the
repository unless they are intentional test assets.
