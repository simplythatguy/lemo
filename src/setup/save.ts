// Done: make (or reuse) the room, upload every image this session made, store the deck, remember the room.
// Each finished upload is written back into the draft, so a retry after a failure only sends what is left.
import { rememberRoom, roomApi } from "../studio/room";
import { toDeck, type Draft } from "./draft";

const PARALLEL = 3;

export async function saveDraft(opts: {
  draft: Draft;
  code: string | null;
  /** The room exists from here on, even if a later step fails. */
  onRoom(code: string): void;
  /** `draft` with one more image uploaded. */
  onUploaded(next: Draft): void;
  onProgress(done: number, total: number): void;
}): Promise<string> {
  let draft = opts.draft;
  const code = opts.code ?? (await roomApi.create()).code;
  opts.onRoom(code);

  const pending = Object.values(draft.slides).filter((s) => s.blob).map((s) => s.id);
  const logo = draft.logo?.blob;
  const total = pending.length + (logo ? 1 : 0);
  let done = 0;
  /** After one upload fails the others stop taking new work and stop reporting progress; finished ones still count. */
  let failed = false;
  opts.onProgress(0, total);
  const step = (next: Draft) => {
    draft = next;
    opts.onUploaded(draft);
    done++;
    if (!failed) opts.onProgress(done, total);
  };

  if (logo) {
    const src = await roomApi.uploadFile(code, logo);
    step({ ...draft, logo: { src } });
  }
  let next = 0;
  let error: unknown;
  const worker = async () => {
    while (next < pending.length && !failed) {
      const id = pending[next++];
      try {
        const src = await roomApi.uploadFile(code, draft.slides[id].blob!);
        step({ ...draft, slides: { ...draft.slides, [id]: { id, src } } });
      } catch (e) {
        failed = true;
        error ??= e;
      }
    }
  };
  // The failure is reported once every upload in flight has landed: none of them can write into the draft after the
  // page hands it back for editing.
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pending.length) }, worker));
  if (failed) throw error;

  await roomApi.putDeck(code, toDeck(draft));
  rememberRoom(code);
  return code;
}
