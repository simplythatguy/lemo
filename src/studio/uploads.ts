// Kept takes go to IndexedDB first, then to the room in 3 MiB chunks. Uploads survive reloads:
// `resume` picks up every unfinished take this device holds for the room.
import { useSyncExternalStore } from "react";
import { CHUNK_BYTES, chunkCount, roomApi, RoomError } from "./room";
import { takeCache, type CachedTake } from "./takeCache";
import type { Group, RecordedTake, RoomState, TakeInfo } from "./types";

/** groupId → fraction uploaded, for takes this device is still sending. */
type Progress = Record<string, number>;

let progress: Progress = {};
const listeners = new Set<() => void>();
const running = new Map<string, AbortController>();
interface RetainedTake extends CachedTake { reason: "slides" | "unverified" | "upload" }
let retained: RetainedTake[] = [];

function retain(take: CachedTake, reason: RetainedTake["reason"]) {
  if (retained.some((t) => t.key === take.key)) return;
  retained = [...retained, { ...take, reason }];
  listeners.forEach((l) => l());
}

export function useRetainedTakes(): readonly RetainedTake[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => retained,
  );
}

function setProgress(groupId: string, value: number | null) {
  const next = { ...progress };
  if (value === null) delete next[groupId];
  else next[groupId] = value;
  progress = next;
  listeners.forEach((l) => l());
}

export function useUploads(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
  );
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** The room holds a newer take of the group than this device's, so this one is no longer wanted. Before this device
 *  has heard its take's id, an unfinished take from the same person can be this one, made before the reply was lost. */
const supersededBy = (theirs: TakeInfo | undefined, take: CachedTake) =>
  !!theirs && theirs.id !== take.takeId && theirs.createdAt > take.createdAt
  && (take.takeId !== null || theirs.received >= theirs.chunks || theirs.personId !== take.personId);

async function upload(take: CachedTake, slides: readonly string[], signal: AbortSignal) {
  const chunks = chunkCount(take.blob.size);
  let backoff = 1000;
  while (!signal.aborted && take.sent < chunks) {
    setProgress(take.groupId, take.sent / chunks);
    try {
      if (!take.takeId) {
        const info = await roomApi.startTake(take.room, {
          groupId: take.groupId, personId: take.personId, durationMs: Math.round(take.durationMs),
          cues: take.cues, mime: take.mime, size: take.blob.size, chunks, slides,
        }, signal);
        if (signal.aborted) return;
        take = await takeCache.put({ ...take, takeId: info.id, sent: 0 });
      }
      const i = take.sent;
      await roomApi.putChunk(take.room, take.takeId!, i, take.blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), signal);
      take = await takeCache.put({ ...take, sent: i + 1 });
      backoff = 1000;
    } catch (e) {
      if (signal.aborted) return;
      // A bad request or a full room will not get better by retrying; the take stays on this device.
      if (e instanceof RoomError && (e.status === 400 || e.status === 409 || e.status === 413)) {
        retain(take, e.status === 409 ? "slides" : "upload");
        break;
      }
      if (e instanceof RoomError && e.status === 404) {
        // The server take is gone (replaced by a newer take for this group, or the room reset).
        let room: RoomState | null;
        try {
          room = await roomApi.get(take.room, signal);
        } catch (e) {
          if (signal.aborted) return;
          // Only a room that is gone ends it; anything else is asked again, never taken as permission to delete.
          if (!(e instanceof RoomError && e.status === 404)) {
            await wait(backoff, signal);
            backoff = Math.min(backoff * 2, 30_000);
            continue;
          }
          room = null;
        }
        if (!room || !room.people.some((p) => p.id === take.personId) || supersededBy(room.takes[take.groupId], take)) {
          await takeCache.remove(take.key);
          break;
        }
        take = await takeCache.put({ ...take, takeId: null, sent: 0 });
        continue;
      }
      await wait(backoff, signal);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
  if (!signal.aborted) setProgress(take.groupId, null);
}

function begin(take: CachedTake) {
  if (!take.slides) {
    retain(take, "unverified");
    return;
  }
  if (retained.some((t) => t.key === take.key)) {
    retained = retained.filter((t) => t.key !== take.key);
    listeners.forEach((l) => l());
  }
  const slot = `${take.room}:${take.groupId}`;
  running.get(slot)?.abort();
  const ctl = new AbortController();
  running.set(slot, ctl);
  void upload(take, take.slides, ctl.signal).finally(() => {
    if (running.get(slot) === ctl) running.delete(slot);
  });
}

export const uploads = {
  /** Saves the take on this device, then uploads it. Replaces any earlier take of the group from here. */
  async keep(room: string, group: Pick<Group, "id" | "name">, personId: string, media: RecordedTake) {
    const groupId = group.id;
    const earlier = (await takeCache.inRoom(room)).filter((t) => t.groupId === groupId && !retained.some((r) => r.key === t.key) && JSON.stringify(t.slides) === JSON.stringify(media.slides));
    // The new take is stored before the earlier ones go: a failed write never leaves the group with neither.
    const take = await takeCache.put({
      key: crypto.randomUUID(), room, groupId, personId, takeId: null,
      blob: media.blob, mime: media.mime, cues: media.cues, durationMs: media.durationMs,
      slides: [...media.slides], name: group.name,
      sent: 0, createdAt: Date.now(),
    });
    running.get(`${room}:${groupId}`)?.abort();
    await Promise.all(earlier.map((t) => takeCache.remove(t.key)));
    const obsolete = new Set(earlier.map((t) => t.key));
    retained = retained.filter((t) => !obsolete.has(t.key));
    setProgress(groupId, 0);
    begin(take);
  },

  /** Restarts every unfinished upload this device holds for the room (after a reload). */
  async resume(room: string, state: RoomState) {
    for (const take of await takeCache.inRoom(room)) {
      if (take.sent >= chunkCount(take.blob.size) || running.has(`${room}:${take.groupId}`)) continue;
      if (!take.slides) {
        retain(take, "unverified");
        continue;
      }
      const group = state.deck?.groups.find((g) => g.id === take.groupId);
      if (!group || JSON.stringify(group.slides.map((s) => s.id)) !== JSON.stringify(take.slides)) {
        retain(take, "slides");
        continue;
      }
      if (supersededBy(state.takes[take.groupId], take)) {
        await takeCache.remove(take.key);
        continue;
      }
      begin(take);
    }
  },
};
