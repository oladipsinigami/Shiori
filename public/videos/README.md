# Shiori hero background videos

The hero ([public/index.html](../index.html)) plays these four clips as the
switchable background. They're portrait anime clips sourced via Pinterest and
shown fullscreen with `object-fit: cover` (sides crop on wide desktops, fill
cleanly on mobile).

| Slot | File                    | Switcher label | Clip                 |
|------|-------------------------|----------------|----------------------|
| 0    | `scene1-shikimori.mp4`  | Slice of Life  | Shikimori-san        |
| 1    | `scene2-kakashi.mp4`    | Quiet Calm     | Naruto / Kakashi     |
| 2    | `scene3-drift.mp4`      | Drift          | (720p clip)          |
| 3    | `scene4-ichigo.mp4`     | Action         | Bleach / Ichigo      |

Optional `overlay.png` (transparent petals/particles) still layers on top if
present; it's skipped automatically when missing.

## Note on slot 2 ("Drift")
Slot index 2 inverts the hero text to dark ink (`#182C41`) — this was designed
for a bright scene. If `scene3-drift.mp4` is a dark clip, the dark text will be
hard to read; either swap a brighter clip into that slot or ask to disable the
inversion (remove the `body[data-scene="2"]` block in
[styles.css](../styles.css)).

## Replacing a clip
Drop a new file with the same name — no code change needed. Keep clips small
(< ~10 MB, H.264 MP4, seamless loop) so the page stays fast on free hosting.
