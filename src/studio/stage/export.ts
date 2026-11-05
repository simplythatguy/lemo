// Real-time render of the recorded takes, with title cards for presentations recorded in parts.
// The take's own <video> drives the timeline, so slide changes land on the words they were cued to.

import { INTRO_MS, OUTRO_MS } from "../timing";
import type { Deck, TakeMedia } from "../types";
import { preload } from "./assets";
import { boxAt } from "./camera";
import { makeStage } from "./stage";

const MIMES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

function pickMime(): string {
  const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("This browser cannot record video.");
  return mime;
}

const aborted = () => new DOMException("Export cancelled.", "AbortError");

export async function exportVideo(opts: {
  deck: Deck;
  takes: Record<string, TakeMedia>;
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
  canvas?: HTMLCanvasElement;
  cards?: boolean;
  monitor?: boolean;
}): Promise<{ blob: Blob; mime: string }> {
  const { deck, takes, onProgress, signal } = opts;
  const cards = opts.cards ?? (deck.recording !== "continuous");
  const intro = cards ? INTRO_MS : 0;
  const outro = cards ? OUTRO_MS : 0;
  if (signal?.aborted) throw aborted();
  const parts = deck.groups.flatMap((group, index) => (takes[group.id] ? [{ group, index, take: takes[group.id] }] : []));
  if (!parts.length) throw new Error("No recorded groups to export.");

  const cleanup: (() => void)[] = [];
  // Every wait below races this, so cancelling unwinds from wherever the export is.
  let rejectAbort: (e: unknown) => void = () => {};
  const abortP = new Promise<never>((_, reject) => (rejectAbort = reject));
  abortP.catch(() => {});
  const onAbort = () => rejectAbort(aborted());
  signal?.addEventListener("abort", onAbort);
  cleanup.push(() => signal?.removeEventListener("abort", onAbort));
  const race = <T,>(p: Promise<T>) => Promise.race([p, abortP]);
  const sleep = (ms: number) => race(new Promise<void>((r) => setTimeout(r, ms)));

  try {
    onProgress?.(0, "Loading");
    await race(preload(deck));

    const audio = new AudioContext();
    cleanup.push(() => void audio.close());
    await race(audio.resume());
    const dest = audio.createMediaStreamDestination();

    const videos = await race(
      Promise.all(
        parts.map(async ({ take }) => {
          const v = document.createElement("video");
          const url = URL.createObjectURL(take.blob);
          cleanup.push(() => {
            v.pause();
            v.removeAttribute("src");
            v.load();
            URL.revokeObjectURL(url);
          });
          v.playsInline = true;
          v.preload = "auto";
          v.src = url;
          await new Promise<void>((resolve, reject) => {
            v.addEventListener("loadeddata", () => resolve(), { once: true });
            v.addEventListener("error", () => reject(new Error("A take could not be read.")), { once: true });
          });
          // Routed into the recording; without the monitor, the speakers stay silent while it renders.
          const source = audio.createMediaElementSource(v);
          source.connect(dest);
          if (opts.monitor) source.connect(audio.destination);
          return v;
        }),
      ),
    );

    const total = intro + parts.reduce((s, p) => s + p.take.durationMs, 0) + outro;
    let doneMs = 0;
    let label = "Intro";
    let phaseStart = performance.now();
    let current: HTMLVideoElement | null = null;
    let tick: (() => void) | null = null;

    const canvas = opts.canvas ?? document.createElement("canvas");
    const stage = makeStage(canvas, deck, {
      beforePaint(now) {
        tick?.();
        const inPhase = current ? current.currentTime * 1000 : now - phaseStart;
        onProgress?.(Math.min(0.999, (doneMs + inPhase) / total), label);
      },
    });
    cleanup.push(() => stage.destroy());

    if (intro) stage.showCard("intro");
    else {
      const first = parts[0];
      const cues = [...first.take.cues].sort((a, b) => a.atMs - b.atMs);
      const initial = cues.filter((c) => c.atMs <= 0).at(-1);
      stage.setCamera(videos[0]);
      stage.show(first.index, initial?.slide ?? 0, { instant: true });
      stage.placeCamera(boxAt(cues, 0, deck), { instant: true });
    }
    // Paint before captureStream creates its first frame, so a full take starts on the slide and camera.
    await race(new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const mime = pickMime();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    cleanup.push(() => stream.getTracks().forEach((t) => t.stop()));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    cleanup.push(() => rec.state !== "inactive" && rec.stop());

    rec.start(1000);
    await sleep(intro);
    doneMs += intro;

    for (const [k, { group, index, take }] of parts.entries()) {
      const v = videos[k];
      const cues = [...take.cues].sort((a, b) => a.atMs - b.atMs);
      label = group.name;
      stage.setCamera(v);
      // Cues at zero apply at once; a later first cue waits for its moment on slide one.
      let cue = 0;
      while (cue < cues.length && cues[cue].atMs <= 0) cue++;
      stage.show(index, cue ? cues[cue - 1].slide : 0);
      stage.placeCamera(boxAt(cues, 0, deck), { instant: true });
      tick = () => {
        const ms = v.currentTime * 1000;
        while (cue < cues.length && cues[cue].atMs <= ms) stage.show(index, cues[cue++].slide);
        stage.placeCamera(boxAt(cues, ms, deck));
      };
      current = v;
      await race(v.play());
      await race(
        new Promise<void>((resolve, reject) => {
          v.addEventListener("ended", () => resolve(), { once: true });
          v.addEventListener("error", () => reject(new Error(`The take for “${group.name}” stopped playing.`)), { once: true });
          // A recorder's duration is sometimes missing; never hang far past the recorded length.
          setTimeout(resolve, take.durationMs + 5000);
        }),
      );
      // Stopped here even when the fallback timer ended it, so its sound never runs under the next take.
      v.pause();
      tick = null;
      current = null;
      doneMs += take.durationMs;
    }

    label = "Outro";
    phaseStart = performance.now();
    if (outro) {
      stage.setCamera(null);
      stage.showCard("outro");
      await sleep(outro);
    }
    rec.stop();
    await race(stopped);
    onProgress?.(1, "Done");
    return { blob: new Blob(chunks, { type: mime }), mime };
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        fn();
      } catch {
        /* already torn down */
      }
    }
  }
}
