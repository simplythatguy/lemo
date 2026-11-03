// Lemo contract shared by setup (upload, groups, transcript), the room (recording) and the stage (painting,
// export). The deck lives on the server with its room (RoomState.deck), so everyone in the room sees the same one. Slides are painted on a 1920×1080 canvas as stills: the only motion is the
// transition between slides, the app clips, the presenter's camera and the logo cards.

/** Script markup: one script segment per slide. The transcript shows a blue arrow between
 *  segments (advance to the next slide, keep talking) and a red box after the last one (stop). */
export interface Group {
  id: string;
  /** Short name shown in the studio, never in the video. */
  name: string;
  /** Index into Deck.team: who presents this group. The room matches it to a person by name, else by join order.
   *  The room assignment overrides it. */
  speaker: number;
  slides: Slide[];
  /** script[i] is what the presenter says while slides[i] is on screen. Same length as slides; "" when unscripted. */
  script: string[];
  /** Recording length in seconds, when set; otherwise timing.ts derives it from the script. */
  seconds?: number;
}

export interface Deck {
  /** The project's name: the intro and outro cards show it. */
  title: string;
  team: string[];
  /** The project's logo (a file URL from the room), painted on the intro and outro cards. */
  logo?: string;
  groups: Group[];
  /** Where the camera tile sat for takes recorded before each take carried its own spot. */
  camera?: Rect;
}

export type Tone = "blue" | "ink" | "grey";

/** A rectangle in the image's own pixel space (natural width/height). */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Mark { rect: Rect; tone?: Tone; label?: string; strike?: boolean }

export type Slide =
  /** An uploaded slide (a PDF or PowerPoint page rendered to a 1920×1080 image), painted full-frame. */
  | { kind: "page"; id: string; src: string }
  /** One idea, huge, centred. `text` may use \n. `sub` is a small grey line under it. */
  | { kind: "statement"; id: string; text: string; sub?: string; accent?: string }
  /** A pre-recorded app clip under a short title. Plays from `from` to `to` (seconds) at `rate`, then holds its last frame. */
  | { kind: "clip"; id: string; title: string; src: string; from?: number; to?: number; rate?: number }
  /** A still (e.g. a filled form page) under a title, cropped to `focus` when given, with `marks` over it. */
  | { kind: "image"; id: string; title: string; src: string; focus?: Rect; marks?: Mark[] }
  /** Two stills side by side, each with a small label underneath and its marks. */
  | { kind: "compare"; id: string; title: string; left: Panel; right: Panel }
  /** Horizontal bars. `value` and `max` share one unit. */
  | { kind: "bars"; id: string; title: string; max: number; unit?: string; bars: Bar[]; note?: string }
  /** One big number with a label. `of` draws "54 / 64" style. */
  | { kind: "count"; id: string; title?: string; value: number; of?: number; prefix?: string; suffix?: string; decimals?: number; label: string }
  /** A grid of `total` dots; the first `lit` are blue. */
  | { kind: "dots"; id: string; title: string; total: number; lit: number; label: string; litLabel?: string }
  /** Steps left to right joined by a line; `active` steps are blue. */
  | { kind: "flow"; id: string; title: string; steps: { label: string; sub?: string }[]; active?: number[] }
  /** The project's logo and name. `names` adds the team underneath (intro). */
  | { kind: "logo"; id: string; names?: string[]; line?: string };

export interface Panel { src: string; label: string; marks?: Mark[] }
export interface Bar { label: string; value: number; highlight?: boolean; note?: string }

/** The four corners and the centre. */
export type Place = "tl" | "tr" | "c" | "bl" | "br";
/** Small and medium are upright; large is wide, with medium fitting inside it. */
export type CameraSize = "s" | "m" | "l";
/** Where the presenter's camera sits, and how big it is there. */
export type Spot = `${Place}-${CameraSize}`;

/** A change inside a take, ms from its first frame: the slide on screen and where the camera sits from then on.
 *  Takes from before spots existed have none: their camera sits where the deck's `camera` says. */
export interface Cue { slide: number; atMs: number; spot?: Spot }

/** One recorded group: the presenter's camera + mic only, plus when each slide was shown. */
export interface TakeMedia { blob: Blob; mime: string; cues: Cue[]; durationMs: number }

export interface Person { id: string; name: string }

export interface TakeInfo {
  id: string;
  groupId: string;
  personId: string;
  durationMs: number;
  cues: Cue[];
  mime: string;
  size: number;
  chunks: number;
  /** Chunks the server already holds; equals `chunks` when the upload is complete. */
  received: number;
  createdAt: number;
}

export interface RoomState {
  code: string;
  people: Person[];
  /** groupId → personId */
  assignments: Record<string, string>;
  /** groupId → latest take */
  takes: Record<string, TakeInfo>;
  updatedAt: number;
  /** The presentation, once someone has set it up. */
  deck: Deck | null;
  /** The take being recorded, as its presenter last published it; null when nobody is recording. */
  live: LiveState | null;
}

/** A take in progress. `at` is the presenter's clock when they sampled it, so it only orders samples.
 *  The server moves `remainingMs` on to the moment it replies. */
export interface LiveState { presenterId: string; groupId: string; slide: number; spot?: Spot; recording: boolean; remainingMs: number; targetMs: number; at: number }

/** A LiveState as this device heard it: `remainingMs` held at `seen`, this device's clock. */
export interface HeardLive extends LiveState { seen: number }

/** The newer of two samples of the same take (or the only one); the WebRTC copy wins a tie. */
export function newerLive(a: HeardLive | null, b: HeardLive | null): HeardLive | null {
  if (!a || !b) return a ?? b;
  return b.at > a.at ? b : a;
}

/** Ms left on a heard take, now. */
export const liveLeft = (live: HeardLive, now = Date.now()) => Math.max(0, live.remainingMs - (now - live.seen));

/** Spoken pace for every timing in the studio. */
export const WORDS_PER_MINUTE = 120;
export const VIDEO_LIMIT_MS = 5 * 60_000;
