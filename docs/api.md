# Room API

Everything lives under `/api`. A room is identified by a 6-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; knowing the code is the only access control (no accounts). JSON uses camelCase. Errors are `{ "detail": "message" }` with a 4xx status. Every write bumps `updatedAt`, which clients poll.

Validated strings cannot contain NUL (`\u0000`). Person path IDs are 12 lower-case hexadecimal characters; file and take path IDs are 32. Malformed resource path IDs return 404.

| Method and path | Body | Reply |
|---|---|---|
| `POST /api/rooms` | `{}` (fresh code) or `{ "code": "ABC234" }` (open or create that one; 1–12 chars, normalised to upper case, must then be a valid 6-char code) | `RoomState`, 201 when created, 200 when it existed |
| `GET /api/rooms/:code` | | `RoomState` |
| `PUT /api/rooms/:code/deck` | `Deck` JSON, at most 1 MiB | `RoomState` |
| `POST /api/rooms/:code/files` | raw bytes; `Content-Type` `image/png`, `image/jpeg` or `image/webp`; at most 4 MiB | `{ "id": "..." }`, 201 |
| `GET /api/rooms/:code/files/:id` | | the bytes, with their content type and `Cache-Control: public, max-age=31536000, immutable` |
| `POST /api/rooms/:code/people` | `{ "name": "..." }` (1–60 chars) | `Person`. Joining with a name already in the room (case-insensitive) returns that person. 409 when 12 people are in. |
| `DELETE /api/rooms/:code/people/:personId` | | `RoomState` (their assignments go too) |
| `PUT /api/rooms/:code/assignments/:groupId` | `{ "personId": "..." \| null }` | `RoomState` |
| `POST /api/rooms/:code/takes` | `{ groupId, personId, durationMs, cues: [{slide, atMs}], mime, size, chunks }` | `TakeInfo`, 201. Replaces the group's previous take. At most 1000 cues. `chunks` must equal `ceil(size / 3 MiB)`. |
| `PUT /api/rooms/:code/takes/:takeId/chunks/:index` | raw bytes, exactly 3 MiB except the last | `{ "received": n }` |
| `GET /api/rooms/:code/takes/:takeId/chunks/:index` | | the bytes |
| `PUT /api/rooms/:code/live?person=:id` | `LiveState` or `null` | the stored `LiveState` or `null` |
| `POST /api/rooms/:code/signals` | `{ from, to, kind: "offer"\|"answer"\|"candidate"\|"bye", data }` (data at most 64 KiB as JSON) | `{ "seq": n }`, 201 |
| `GET /api/rooms/:code/signals?to=:id&after=:seq` | | `{ signals: [{seq, from, kind, data, at}], last }` |

Types are in `src/studio/types.ts` (`RoomState`, `Deck`, `TakeInfo`, `LiveState`).

A deck has a string `title`, a list of strings `team`, and a list of `groups`. Each group has an `id` (1–40 of a-z, 0-9 and -), a string `name`, `slides` (objects with a string `kind`), and `script` (strings); `speaker` and `seconds` are optional finite numbers. Slide kinds and extra fields round-trip unchanged. Optional `logo` is a string; optional `camera` has finite numeric `x`, `y`, `w`, and `h`. The whole deck is still limited to 1 MiB.

Limits: a take is at most 150 MiB, a room's takes and files at most 600 MiB together, signals expire after 10 minutes (at most 2000 per room, 200 per page), a live row older than 10 s reads as `null`, and a room is deleted 14 days after it was created.

Storage: Postgres when `DATABASE_URL` is set (production), otherwise a SQLite file at `.data/lemo.sqlite` (local).
