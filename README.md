# Lemo

Record a team demo video without anyone starting over.

1. **Upload your slides.** Drop in a PDF or a PowerPoint. Slides must be 16:9.
2. **Write the script.** Cut the slides into groups and type what's said on each slide.
3. **Record your part.** Everyone opens the room link and turns on their camera. Each group is assigned to one person, who records it with only their own camera and mic. The others see the slide and the transcript live. Groups can be recorded in any order and retaken. Drag the camera on the slide to move it, or drag its edge or corner to resize it. Double-click it to put it back.
4. **Make the video.** Lemo joins the groups into one 1080p video. It starts with your logo, project name and team, and ends with a logo card.

Keys while recording: `R` to record, `→` / `←` to change slides, `Enter` to stop, `Esc` to cancel.

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

The API is described in [docs/api.md](docs/api.md). `npm test` runs the server tests, `npm run build` typechecks and builds, and `npm run smoke` starts `npm run dev` and saves a room through it. CI runs all of them on Windows, macOS and Linux for every pull request.

## Limits

- Anyone with the room link can join. There are no accounts.
- PowerPoint files are drawn in the browser, so fonts you don't have installed fall back to another font, and SmartArt, charts and video may look different from PowerPoint. If something looks off, export to PDF and upload that.
- A take is at most 150 MB, and a room's takes and images at most 600 MB.
- Cameras connect directly between browsers, with a public relay server as a fallback. Some strict networks can still block them. Recording still works, but teammates may not see each other live.
