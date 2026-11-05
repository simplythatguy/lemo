# Lemo

Record a team demo video without anyone starting over.

1. **Upload your slides.** Drop in a PDF or PowerPoint. The video keeps the document's aspect ratio, including portrait pages. For PDFs with mixed page sizes, the first page sets the video frame and the other pages fit inside it without cropping.
2. **Choose how to record.** **One take** records the whole deck continuously as you change pages. Choose **In parts** to record and retake separate slide groups. Drag slides to reorder them and optionally write what you'll say on each page. In Project, leave **Time limit (minutes)** blank to record until Stop, or enter your own limit. Scripts never set the recording length.
3. **Record.** Everyone opens the room link and turns on their camera. One presenter records a take with their own camera and mic; the others see the slides and transcript live. Click your camera (or press C) to move it to a corner or the centre, wide or upright, small, medium, or large, also while recording. Each place remembers its last shape and size on your device. The arrow keys walk through the pages without interrupting the take. In parts mode, right-click a slide in the strip to split its group there, hover between groups to join them, or hide a group from its menu (only on your device).
4. **Make the video.** Download a video with the slides, camera moves and sound from your take. Continuous takes have no added title cards. In parts mode, Lemo joins the groups and adds intro and outro cards. The output's longest edge is at most 1920 pixels; older decks keep their 1920×1080 frame.

Use **Full screen** in the room's top bar for just the slides and your camera. Tap your camera (or press `C`) to move it and change its shape or size. Page and recording controls appear when you move the pointer, tap, or use Tab. Escape leaves this view without stopping a running take; close an open camera picker with Escape first. Browsers without native fullscreen use the same view inside the browser window.

Keys: `R` to record; `→` / `↓` for the next slide; `←` / `↑` for the previous slide; `Enter` to stop or keep. In the regular room, `Esc` cancels. While the camera picker is open, arrows choose camera positions.

## Run it locally

You need [Node.js](https://nodejs.org) 22.18 or newer, on Windows, macOS or Linux. `npm install` stops with an error on an older Node.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The web app runs on port 5173 and the room server on 8787. Rooms are saved in `.data/lemo.sqlite`.

## Put it online (Vercel)

1. Import this repo in [Vercel](https://vercel.com/new). The settings come from `vercel.json`.
2. Add a Postgres database. In the project, open **Storage**, choose **Neon** and connect it. This sets `DATABASE_URL`, which is the only setting Lemo needs.
3. Deploy. Recorded takes and slide images are stored in that database. A room and everything in it is deleted 14 days after it was made.

## How it fits together

| Folder | What it is |
|---|---|
| `src/setup` | Upload, project details, groups and script |
| `src/studio` | The recording room: cameras, transcript, recording, and the canvas that paints the video (`stage/`) |
| `src/home` | The list of your demos |
| `server` | The room server: rooms, people, slide images, takes in 3 MB chunks, and the connection handshake between cameras. SQLite locally, Postgres online |
| `api` | The Vercel function that runs the room server |

The API is described in [docs/api.md](docs/api.md). Why a take sometimes needs a click before it plays with sound, and how to test that, is in [docs/playback.md](docs/playback.md). The design rules and tokens are in [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md). `npm test` runs the server tests, `npm run build` typechecks and builds, and `npm run smoke` starts `npm run dev` and saves a room through it. CI runs all of them on Windows, macOS and Linux for every pull request.

## Limits

- Anyone with the room link can join. There are no accounts.
- PowerPoint files are drawn in the browser, so fonts you don't have installed fall back to another font, and SmartArt, charts and video may look different from PowerPoint. If something looks off, export to PDF and upload that.
- A take is at most 150 MB, and a room's takes and images at most 600 MB.
- Brave with autoplay blocked, and Safari, won't start a take with sound on their own. The player shows a large play button instead. Click it.
- Cameras connect directly between browsers, with a public relay server as a fallback. Some strict networks can still block them. Recording still works, but teammates may not see each other live.
