# AGIWM Flyer Studio server

One Node app that serves the flyer studio (`/`), the Claude connector (`/mcp/<secret>`) and a small live API (`/api/*`).

## Live flyer
The server keeps one **live flyer**. Anyone with the studio open and connected sees it change at once.
In the studio one flyer of the deck is the live one (marked **LIVE** in the flyer strip; "Make live" moves it). Only that flyer is sent to the server and only it takes Claude's changes; other flyers stay in the browser. Studio saves name the version they were made on; if Claude changed the flyer meanwhile, the server answers 409 and the studio puts its own change on top of the new flyer and sends again. Hand edits show in the feed as a short summary ("Studio: left name, right photo").
- Claude: `update_flyer` changes only the fields you name; changes build up across messages. Hand edits made in the studio are visible to Claude (`get_flyer`, `render_current_flyer`).
- The studio shows each instruction in its **Live** panel (top bar).
- Connect a browser once by opening `https://YOUR-HOST/#live=<secret>` (the key is stored in that browser).

## Photo library
Put photos in `DATA_DIR/photos` named after the person (`Pastor_Elizabeth_Amara.jpg`), or use the `add_person` tool. Then use `"person": "Pastor Elizabeth"` on a speaker and the photo (and name) are filled in. Optional details (aliases, place) live in `DATA_DIR/people.json`:
`{"Pastor_Elizabeth_Amara": {"name": "Pastor Elizabeth Amara", "aliases": ["Pr Elizabeth"], "place": "Maryland, USA"}}`

## Tools
`update_flyer`, `get_flyer`, `reset_flyer`, `render_current_flyer`, `make_flyer` (one-off, does not touch the live flyer), `list_people`, `add_person`, `remove_person`, `flyer_options`.

## HTTP API (for a WhatsApp bot later)
All need the key in the header `x-flyer-key: <secret>` (`?k=<secret>` still works for old clients, but puts the key in logs).
- `POST /api/upload` with the image bytes (`Content-Type: image/jpeg`, png, webp or gif) or JSON `{"dataUrl": "data:image/..."}` returns `{url, photo_url, expires}`. Use `url` (or `photo_url`, `upload:<token>`) as `photo_url` in the tools for the next 2 hours.
- `PUT /api/state` (used by the studio) takes `baseVersion`; a stale one gets 409 with the current state.
- `POST /api/live-token` returns a 10-minute token for `GET /api/live?t=<token>` (the event stream cannot send headers).
- `POST /api/patch` with the same fields as `update_flyer` (plus `"by":"WhatsApp"`) changes the live flyer.
- `GET /api/render.png?size=1280x720` returns the current flyer as an image.
- `GET /api/state`, `GET /api/people`, `GET /api/live` (server-sent events).
A WhatsApp bot would: receive the group message, ask an AI to turn it into an `update_flyer`-style JSON, `POST /api/patch`, then send back `GET /api/render.png`.

## Photos from links
`photo_url` (and `add_person`) accept https links to JPG / PNG / WebP / GIF files, Google Drive share links (`.../file/d/<id>/...`, `open?id=`, `uc?id=`; the file must be shared as "Anyone with the link"), data:image URLs, and upload links from `POST /api/upload`. The type is read from the file itself, so a sign-in page or HEIC photo gets a clear message instead of an empty card.

## Dates and times
The India box is the anchor: change only its date or time (tool, API or studio) and the US box is worked out for the same moment (IST = EDT + 9:30 from the 2nd Sunday of March to the 1st Sunday of November, otherwise EST + 10:30; the US date is the day before when it crosses midnight). A US time whose EDT/EST name does not fit its date keeps its moment (9:00 PM EDT on 20 Nov 2026 becomes 8:00 PM EST). The studio warns when the two boxes are not the same moment. The code is `tz.js`, shared with the studio.

## Settings (environment variables)
- `MCP_SECRET` (required in production): protects the connector and the API.
- `DATA_DIR`: where the live flyer and photo library are kept. Point it outside the app folder (for example `/home/<you>/flyer-data`) so redeploys do not erase it.
- `PORT`: set by the host.

- `CHROMIUM_SINGLE_PROCESS=1`: run the bundled Chromium with `--single-process --no-zygote` again (only if the host refuses to start its normal helper processes; it made renders crash after a page closed).
- `RENDER_TIMEOUT_MS` (60000), `RENDER_LAUNCH_TIMEOUT_MS` (60000), `RENDER_QUEUE_CAP` (6): a render that takes longer is stopped (the browser is restarted and the render tried once more) so later renders are not stuck; more waiting renders than the cap get "busy, try again".

## Run locally
    npm install
    MCP_SECRET=test npm start       # http://localhost:8080
Chromium is bundled (`@sparticuz/chromium`); `CHROMIUM_PATH` can point at a system Chrome instead.

## Editing the studio
`../index.html` is the studio; `flyer-studio.html` here must be an identical copy (the server serves and renders it). `tz.js`, `schedparse.js` and `invite.js` are shared with the studio: they are inlined into index.html between `/* @inline ... */` markers. After editing index.html or one of those files run

    node sync-studio.mjs        # or: npm run sync

which refreshes the inlined code and copies index.html here. `npm test` fails if they are out of step.

## Tests
- `npm test`: unit tests (no browser): times, schedule parsing, invite text, photo library names, Drive links and uploads, framing, live-flyer conflicts, renderer queue and retry.
- `browser-tests/`: headless-browser tests of the studio and the renderer (see its README).
- `node smoke.mjs`: starts the server and renders one flyer over MCP.

## Fonts
The flyer's fonts are Google web fonts, Telugu included (every font falls back to Noto Sans / Noto Serif Telugu, so Telugu text renders even on a server with no Telugu fonts installed). The renderer waits for them before taking the picture. The Docker image also installs `fonts-noto-core` as an offline fallback.

## Text styling

Nothing is grouped: every text and every object (logo, speaker cards, time boxes, Zoom block, YouTube block, button) is its own layer. Click any one, or pick it in Layers, to change its text, font, colour, opacity, size, letter spacing, weight, capitals, position (drag it, or use the arrow keys; Shift = 10px), rotation and visibility. The AI assistant and MCP `text_styles` do the same (`font`, `weight`, `capitals`, `move_x`, `move_y`, `rotate`, `visible`, plus colour / opacity / size / spacing). Text layer keys: ttl, sub, loc, scr, hd, tg0/tg1/tg2 (`tags` = all three), lbL/nmL/plL, lbR/nmR/plR, d1dt/d1wd/d1tm, d2dt/d2wd/d2tm, zl, zid, zpw, yl, yh, jt. Object layer keys (opacity, size, move, rotate only): logo, left, right, d1, d2, zoom, yt, btn.

## Monthly schedule (MCP tools and API)

- `plan_schedule` - paste a list like "1st week of November Rev X / 2nd week ... Dr Y", "Week 1 - Name", "Jan 10: Name" or "10 Jan - Name"; get one planned flyer per week (Saturdays by default, the US date and time worked out from the India time, a different colour set each, photo from the library when the name matches, "To be announced" for worship). The month is the first month named; a small-letter "may" is not a month. Dates in the past are flagged. The answer starts with a **plan id**.
- `make_schedule` - the same, then renders every week as an image (good for a WhatsApp group). `common` holds anything shared by all weeks (a `right_speaker` there replaces "To be announced").
- `publish_week` / `invite_text` - week N of a plan; pass `plan_id` so another person planning at the same time cannot change which plan you get (without it: the newest plan on the server).
- HTTP: `POST /api/schedule {"text": "..."}` (answer has `plan_id`) then `GET /api/schedule/2.png?size=1280x720&plan=<plan_id>` (key in `x-flyer-key`).

## Studio layouts

The header button cycles Floating (default), Slides and Photoshop. Floating: canvas first, a tool bar at the bottom (Move, Text, Photo, Colour, Dates, Layers, Flyers, AI) and a card with the options. Download menu: PNG/JPG sizes, JPG for WhatsApp, and all flyers as one zip.

## WhatsApp invitation text

The same fields that draw the flyer also write the invitation message, so the text and the image always match:

```
🙏 AGIWM Women's Prayer Meeting

📖 Word: Evangelist Preethi Reddy
🎶 Worship: Sis. Dolly Priyadarshini & Bro. Jonah

🇮🇳 31 Oct, 6:30 AM IST
🇺🇸 30 Oct, 9:00 PM EDT

💻 Zoom: https://zoom.us/j/9969598014
ID: 996 959 8014 | Passcode: 202022

▶️ YouTube: https://www.youtube.com/@AGIMUSA

Come and be Blessed! 🙌
```

- **Studio:** the "Invite text" button in the top bar (or File menu > Invite text for WhatsApp) opens the message. Edit it, then:
  - **Share picture + text** (phones and tablets): pick WhatsApp and the flyer arrives with the text under it. If WhatsApp shows only the picture, use Copy text and paste it as the caption.
  - **Save picture + copy text** (computers): saves the flyer as a 1280x720 JPG and copies the text in one click; in WhatsApp attach the picture and paste the text as its caption. **Copy picture** puts the picture on the clipboard for Ctrl+V into WhatsApp Web.
  - **WhatsApp (text only)**: on a phone this opens WhatsApp; on a computer it opens WhatsApp Web. The wa.me link is not used on a computer, because it opens the WhatsApp desktop app, which can turn emoji into ? marks and cut the text at an "&".
  - Paste Zoom's own invite link in the box if you have one (it is remembered in this browser); otherwise a plain link is made from the meeting ID.
- **Connector:** `invite_text` returns the message for the live flyer, or for week N of the last `plan_schedule`. `make_flyer`, `render_current_flyer` and `update_flyer` (with preview) return the picture and the text together (`with_invite: false` for the picture only). `make_schedule` returns each week's text next to its image.
- **API (for the bot):** `GET /api/invite?k=...` for the live flyer, `GET /api/schedule/2.txt?k=...` for week 2, and the matching `.png` / `.jpg` for the picture. Optional `zoom=` and `closing=`. A bot sends the picture with the text as its caption in one message.
- Names and headings typed all in capitals or all in small letters on the flyer are written in normal capitals in the message. Hidden speakers, dates, Zoom or YouTube are left out.
- The code is in `invite.js`; the studio build inlines the same file.
