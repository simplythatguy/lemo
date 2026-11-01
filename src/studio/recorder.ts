// This device's camera and mic, and recording one take from them.

// avc3 carries its parameters in-band, so a camera that changes resolution mid-take still yields a valid file.
const MIME_PREFERENCE = [
  "video/mp4;codecs=avc3.42E01F,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function recordingMime(): string {
  return MIME_PREFERENCE.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export async function openCamera(camId?: string, micId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: camId ? { ...video, deviceId: { exact: camId } } : video,
      audio: micId ? { ...audio, deviceId: { exact: micId } } : audio,
    });
  } catch (e) {
    // A remembered device that is gone: fall back to the defaults.
    if (camId || micId) return navigator.mediaDevices.getUserMedia({ video, audio });
    throw e;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export async function listDevices(): Promise<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return { cams: all.filter((d) => d.kind === "videoinput"), mics: all.filter((d) => d.kind === "audioinput") };
}

/** A take in progress. `startedAt` is the performance.now() of the first recorded frame (cue zero). */
export interface Recording {
  startedAt: number;
  stop(): Promise<{ blob: Blob; mime: string }>;
  cancel(): void;
}

/** Records the stream as it is: the preview keeps using the same tracks, nothing is reopened. */
export function startRecording(stream: MediaStream): Promise<Recording> {
  const mimeType = recordingMime();
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  return new Promise((resolve, reject) => {
    rec.onerror = (e) => reject((e as ErrorEvent).error ?? new Error("Recording failed"));
    rec.onstart = () => {
      const startedAt = performance.now();
      resolve({
        startedAt,
        stop: () =>
          new Promise((done) => {
            rec.onstop = () => {
              const mime = rec.mimeType || mimeType || parts[0]?.type || "video/webm";
              done({ blob: new Blob(parts, { type: mime }), mime });
            };
            if (rec.state !== "inactive") rec.stop();
          }),
        cancel: () => {
          rec.onstop = null;
          if (rec.state !== "inactive") rec.stop();
        },
      });
    };
    rec.start(1000);
  });
}

/** Plays `stream` in an element that lives for the page, so the stage can paint it as the camera tile. */
export function liveVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.setAttribute("aria-hidden", "true");
  Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(v);
  return v;
}
