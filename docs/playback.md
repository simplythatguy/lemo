# Playing takes with sound

## What went wrong

A teammate in Brave opened a take from **Saved** (the deck icon at the top right, then the play button on a group). The take showed but made no sound. A downloaded copy of the same take had sound.

The player downloads the take, then calls `video.play()` itself. By then the click that opened the player was seconds ago. Some browsers start sound only from a click, so they refused that `play()` call:

- Brave with autoplay set to **Block** (Settings → Site and Shields Settings → Autoplay).
- Safari, which asks for a click before sound by default.

The refusal was caught and ignored. The player stayed on its first frame and was silent. Its only sign was a small play button in the bar below the video. The review after a recording had the same problem: it calls `play()` after the recording stops.

A downloaded file plays in another app, so it was never affected.

## The rule

Start a take's sound with `startPlayback` (`src/studio/playback.ts`), never with a bare `video.play()` whose result is ignored. When `startPlayback` resolves `false`, show `StartButton` (`src/studio/parts.tsx`) over the stage. Its click calls `play()` again, and browsers always allow that.

Measured in Brave 1.98 with autoplay blocked and a take that takes 6 s to download:

| | Before | After |
|---|---|---|
| Player opens | Paused, silent | Paused, a large play button in the middle of the stage |
| After one click | n/a (only the small button in the bar worked) | Plays with sound |

Browsers that allow autoplay (Chrome, Arc, Edge, Brave by default) start the take on their own and never show the button.

## What does not work

Brave with autoplay blocked refuses every one of these when the take loads after the click:

- Calling `play()` during the click on an element that has no source yet, or swapping the source in afterwards.
- Routing the element through an `AudioContext` that was started during the click.
- Playing the element muted and then unmuting it.

Only a click on an element whose data has loaded is allowed to start it.

## Testing it

Fake media flags make autoplay look allowed, and headless browsers have no speakers. Test in a real Brave window:

1. Set Brave's autoplay setting to **Block**.
2. Throttle the network (DevTools → Network → Slow 4G) so the take takes more than 5 seconds to download.
3. Open a take from **Saved**. The large play button must appear, and one click must play the take with sound.

## Related limits

- **Download** renders by playing each take in the page. That play also starts without a click, so it is expected to fail in Brave with autoplay blocked. This was not changed.
- A take recorded in Chrome or Arc is saved as `avc3` H.264, and WebKit (Safari's engine) refused to load it in testing. Safari users may not be able to play a teammate's Chrome take.
- In a Safari private window, the browser refuses to store takes, so the player can stop at 100%.
