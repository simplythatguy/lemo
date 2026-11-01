// Starting a take with its sound. Some browsers start sound only from a click on media that has already loaded:
// Brave with autoplay blocked, and Safari. A take finishes downloading long after the click that opened it,
// so its first play() can be refused. See docs/playback.md.

/** Plays `v`. False when the browser refused to start sound without a click: show StartButton, whose click plays it. */
export function startPlayback(v: HTMLVideoElement): Promise<boolean> {
  return v.play().then(
    () => true,
    (e: unknown) => !(e instanceof DOMException && e.name === "NotAllowedError"),
  );
}
