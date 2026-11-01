// Kept takes go to IndexedDB first, then to the room in 3 MiB chunks. Uploads survive reloads:
// `resume` picks up every unfinished take this device holds for the room.
import { useSyncExternalStore } from "react";
import { CHUNK_BYTES, chunkCount, roomApi, RoomError } from "./room";
import { takeCache, type CachedTake } from "./takeCache";
import type { RoomState, TakeMedia } from "./types";

/** groupId → fraction uploaded, for takes this device is still sending. */
type Progress = Record<string, number>;

let progress: Progress = {};
const listeners = new Set<() => void>();
const running = new Map<string, AbortController>();

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

async function upload(take: CachedTake, signal: AbortSignal) {
  const chunks = chunkCount(take.blob.size);
  let backoff = 1000;
  while (!signal.aborted && take.sent < chunks) {
    setProgress(take.groupId, take.sent / chunks);
    try {
      if (!take.takeId) {
        const info = await roomApi.startTake(take.room, {
          groupId: take.groupId, personId: take.personId, durationMs: Math.round(take.durationMs),
          cues: take.cues, mime: take.mime, size: take.blob.size, chunks,
        });
        if (signal.aborted) return;
        take = await takeCache.put({ ...take, takeId: info.id, sent: 0 });
      }
      const i = take.sent;
      await roomApi.putChunk(take.room, take.takeId!, i, take.blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), signal);
      take = await takeCache.put({ ...take, sent: i + 1 });
      backoff = 1000;
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof RoomError && e.status === 401) break;
      if (e instanceof RoomError && e.status === 404) {
        // The server take is gone (replaced by a newer take for this group, or the room reset).
        const room = await roomApi.get(take.room).catch(() => null);
        const theirs = room?.takes[take.groupId];
        if (!room || !room.people.some((p) => p.id === take.personId) || (theirs && theirs.createdAt > take.createdAt)) {
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
  const slot = `${take.room}:${take.groupId}`;
  running.get(slot)?.abort();
  const ctl = new AbortController();
  running.set(slot, ctl);
  void upload(take, ctl.signal).finally(() => {
    if (running.get(slot) === ctl) running.delete(slot);
  });
}

export const uploads = {
  /** Saves the take on this device, then uploads it. Replaces any earlier take of the group from here. */
  async keep(room: string, groupId: string, personId: string, media: TakeMedia) {
    const earlier = (await takeCache.inRoom(room)).filter((t) => t.groupId === groupId);
    running.get(`${room}:${groupId}`)?.abort();
    await Promise.all(earlier.map((t) => takeCache.remove(t.key)));
    const take = await takeCache.put({
      key: crypto.randomUUID(), room, groupId, personId, takeId: null,
      blob: media.blob, mime: media.mime, cues: media.cues, durationMs: media.durationMs,
      sent: 0, createdAt: Date.now(),
    });
    setProgress(groupId, 0);
    begin(take);
  },

  /** Restarts every unfinished upload this device holds for the room (after a reload). */
  async resume(room: string, state: RoomState) {
    for (const take of await takeCache.inRoom(room)) {
      if (take.sent >= chunkCount(take.blob.size) || running.has(`${room}:${take.groupId}`)) continue;
      const theirs = state.takes[take.groupId];
      if (theirs && theirs.id !== take.takeId && theirs.createdAt > take.createdAt) {
        await takeCache.remove(take.key);
        continue;
      }
      begin(take);
    }
  },
};
