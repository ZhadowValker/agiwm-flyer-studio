# Browser tests

Headless tests for the studio page and the renderer. They serve html2canvas and the Google fonts from
local npm packages, so they also run without internet access.

    cd mcp-server/browser-tests
    npm install
    CHROME_PATH=/path/to/chrome npm test

- `mcp-test.mjs` – connector tools and HTTP API on a local server (plan ids, uploads, 409, tokens).
- `studio-test.mjs` – photos (framing, fit, HEIC/empty/damaged files), long names, Telugu heading, time warning, file names, touch drag.
- `live-test.mjs` – live link: only the live flyer syncs, conflicts are merged, feed summaries, no key in addresses.
- `export-test.mjs` – the first export after loading matches later ones.
- `render-test.mjs` – the server renderer (bundled Chromium unless `CHROMIUM_PATH`): palette PNG, Telugu, queue, recovery after the browser dies.
