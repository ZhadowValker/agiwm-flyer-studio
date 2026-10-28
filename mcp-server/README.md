# AGIWM Flyer Studio MCP

A remote MCP server (Streamable HTTP) that lets Claude make the AGIWM Women's Prayer Meeting flyer.
It loads `flyer-studio.html` (the same studio page) in headless Chromium, fills it from the tool
arguments, and returns the finished 2000x1125 PNG/JPG.

## Tools
- `make_flyer` – every field optional; leave out what stays default. Names, dates (YYYY-MM-DD, weekday and "24th" are automatic),
  times, flags, Zoom ID/passcode, YouTube handle, button text, photos and background image (https or data URLs),
  background gradient/preset/colour, accent colours, fonts per text. `format`: png|jpg, `size`: 2000x1125|1920x1080|1280x720.
- `flyer_options` – lists fonts, flags, presets and the AGIWM defaults.

## Run locally
    npm install && npx playwright install chromium
    npm start            # http://localhost:8080/mcp
    npm test             # end-to-end call over MCP

## Deploy (hosted)
Any Docker host works (Render, Fly.io, Railway, Cloud Run). Build with the included `Dockerfile`
(Playwright image, ~1 GB RAM recommended). Set `MCP_SECRET=<long random string>` so the endpoint becomes
`https://YOUR-HOST/mcp/<secret>` (keeps strangers from using your server).

## Add to Claude
Settings > Connectors > Add custom connector > paste `https://YOUR-HOST/mcp/<secret>`.
Then ask: "Make the AGIWM flyer for Nov 7 with speaker Pastor Elizabeth Amara, emerald theme."

Notes: the server needs internet access at render time (Google Fonts, html2canvas from cdnjs).
Gradient text is not supported by the exporter; renders are queued one at a time.
