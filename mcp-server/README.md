# AGIWM Flyer Studio server

One Node app that serves the flyer studio (`/`), the Claude connector (`/mcp/<secret>`) and a small live API (`/api/*`).

## Live flyer
The server keeps one **live flyer**. Anyone with the studio open and connected sees it change at once:
- Claude: `update_flyer` changes only the fields you name; changes build up across messages. Hand edits made in the studio are visible to Claude (`get_flyer`, `render_current_flyer`).
- The studio shows each instruction in its **Live** panel (top bar).
- Connect a browser once by opening `https://YOUR-HOST/#live=<secret>` (the key is stored in that browser).

## Photo library
Put photos in `DATA_DIR/photos` named after the person (`Pastor_Elizabeth_Amara.jpg`), or use the `add_person` tool. Then use `"person": "Pastor Elizabeth"` on a speaker and the photo (and name) are filled in. Optional details (aliases, place) live in `DATA_DIR/people.json`:
`{"Pastor_Elizabeth_Amara": {"name": "Pastor Elizabeth Amara", "aliases": ["Pr Elizabeth"], "place": "Maryland, USA"}}`

## Tools
`update_flyer`, `get_flyer`, `reset_flyer`, `render_current_flyer`, `make_flyer` (one-off, does not touch the live flyer), `list_people`, `add_person`, `remove_person`, `flyer_options`.

## HTTP API (for a WhatsApp bot later)
All need the key: `?k=<secret>` or header `x-flyer-key`.
- `POST /api/patch` with the same fields as `update_flyer` (plus `"by":"WhatsApp"`) changes the live flyer.
- `GET /api/render.png?size=1280x720` returns the current flyer as an image.
- `GET /api/state`, `GET /api/people`, `GET /api/live` (server-sent events).
A WhatsApp bot would: receive the group message, ask an AI to turn it into an `update_flyer`-style JSON, `POST /api/patch`, then send back `GET /api/render.png`.

## Settings (environment variables)
- `MCP_SECRET` (required in production): protects the connector and the API.
- `DATA_DIR`: where the live flyer and photo library are kept. Point it outside the app folder (for example `/home/<you>/flyer-data`) so redeploys do not erase it.
- `PORT`: set by the host.

## Run locally
    npm install
    MCP_SECRET=test npm start       # http://localhost:8080
Chromium is bundled (`@sparticuz/chromium`); `CHROMIUM_PATH` can point at a system Chrome instead.

## Text styling

Every text on the flyer has its own colour, opacity, size and letter spacing (studio: click the text, scroll to its "style" group, or open "Text styles"; AI assistant and MCP `text_styles` do the same). Layer keys: ttl, sub, loc, scr, hd, tags, lbL/nmL/plL, lbR/nmR/plR, d1dt/d1wd/d1tm, d2dt/d2wd/d2tm, zl, zid, zpw, yl, yh, jt.

## Monthly schedule (MCP tools and API)

- `plan_schedule` - paste a list like "1st week of November Rev X / 2nd week ... Dr Y"; get one planned flyer per week (Saturdays by default, US date the day before, a different colour set each, photo from the library when the name matches).
- `make_schedule` - the same, then renders every week as an image (good for a WhatsApp group). `common` holds anything shared by all weeks.
- `publish_week` - load week N of the last plan into the live flyer open in the studio.
- HTTP: `POST /api/schedule {"text": "..."}` then `GET /api/schedule/2.png?size=1280x720` (key as `?k=` or `x-flyer-key`).

## Studio layouts

The header button cycles Floating (default), Slides and Photoshop. Floating: canvas first, a tool bar at the bottom (Move, Text, Photo, Colour, Dates, Layers, Flyers, AI) and a card with the options. Download menu: PNG/JPG sizes, JPG for WhatsApp, and all flyers as one zip.
