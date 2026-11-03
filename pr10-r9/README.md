# Lemo PR10 — current evidence

Application source: `5ba94ebbf1e5ceb8d657fb5dd1e982a73cbb62d6`.

All PNG/WebM/MP4 files in this folder were captured from that source using local Chromium, synthetic camera/microphone media and SQLite. The complete app is present on this branch; existing evidence from earlier rounds remains unchanged and retains its original revision.

Verification: 69 repository tests; TypeScript, build and smoke; 22 distinct camera/dock browser cases. The optional portable suite in `regressions/` was rerun serially: 22 passed, zero failures or skips. This rerun is the same 22 cases, not additional unique coverage. Full desktop and phone recording flows each captured 44 states, including PDF/PowerPoint import, grouping, scripts, three people, recording/review/Keep, saved playback and merging.

`desktop-demo.webm` and `phone-demo.webm` demonstrate camera-off start through recording, review and Keep. All 57 sampled frames at 3fps were inspected. `harbor-demo.mp4` is the downloaded composed video: 1920×1080, 23.102333 seconds, 2,869,274 bytes. Its byte hash matches the source decoded by the browser. Playback advanced without media/page errors, and all 24 samples across its duration at 1fps were inspected. The first sample remains blank. Sampled inspection does not establish full-speed or audible playback.

Physical devices, other browsers, cross-device WebRTC, production and new Postgres runtime checks remain unverified. Fresh independent review and checks at the application head are required before merge; this evidence folder is not an approval.
