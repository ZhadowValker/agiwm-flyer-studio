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

Nothing is grouped: every text and every object (logo, speaker cards, time boxes, Zoom block, YouTube block, button) is its own layer. Click any one, or pick it in Layers, to change its text, font, colour, opacity, size, letter spacing, weight, capitals, position (drag it, or use the arrow keys; Shift = 10px), rotation and visibility. The AI assistant and MCP `text_styles` do the same (`font`, `weight`, `capitals`, `move_x`, `move_y`, `rotate`, `visible`, plus colour / opacity / size / spacing). Text layer keys: ttl, sub, loc, scr, hd, tg0/tg1/tg2 (`tags` = all three), lbL/nmL/plL, lbR/nmR/plR, d1dt/d1wd/d1tm, d2dt/d2wd/d2tm, zl, zid, zpw, yl, yh, jt. Object layer keys (opacity, size, move, rotate only): logo, left, right, d1, d2, zoom, yt, btn.

## Monthly schedule (MCP tools and API)

- `plan_schedule` - paste a list like "1st week of November Rev X / 2nd week ... Dr Y"; get one planned flyer per week (Saturdays by default, US date the day before, a different colour set each, photo from the library when the name matches).
- `make_schedule` - the same, then renders every week as an image (good for a WhatsApp group). `common` holds anything shared by all weeks.
- `publish_week` - load week N of the last plan into the live flyer open in the studio.
- HTTP: `POST /api/schedule {"text": "..."}` then `GET /api/schedule/2.png?size=1280x720` (key as `?k=` or `x-flyer-key`).

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
