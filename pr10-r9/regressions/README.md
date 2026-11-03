# Local camera and dock regressions

These optional Chromium checks create disposable rooms on a local Lemo server. They use synthetic camera and microphone streams and never target a remote host. Start the app with local SQLite:

```sh
env -u DATABASE_URL npm run dev
```

In a disposable checkout, install the tested browser runner and Chromium, then run the checks serially:

```sh
npm install --no-save --package-lock=false playwright@1.64.1
npx playwright install chromium
node --test --test-concurrency=1 pr10-r9/regressions/*.test.mjs
```

If Playwright is already installed elsewhere, `LEMO_PLAYWRIGHT_MODULE` may point to its ESM entry instead. Results go to `pr10-r9/results/`. The application source is unchanged by these checks; local test rooms and media remain in that checkout's `.data/` directory.

There are 22 cases: camera-off initialization through Record/Retake and R/button, live-track and saved-take checks at desktop/phone widths, cancellation, denied reopen/retry, first dock actions, and protection against a second Keep tap. The held camera-off request wraps an actual successful `getUserMedia` call; it does not fabricate a recorder error. Permission failure is a separate explicit boundary simulation.

The regression logic matches the retained parent checks. Portability changes resolve Playwright and fixtures without workspace paths, place results beside the suite, and give the cold Make case its own single-group recorded room instead of depending on an earlier full-flow fixture.
