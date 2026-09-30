# Kopitiam Agent IDE Sprite Production Plan

Revision 2 · Delivered miniature artwork and integration guide · 30 September 2026

This edition documents the delivered sprites and how to use them. It replaces the earlier proposed large character dimensions with the tiny, chunky proportions approved in the conversation. The kopitiam background remains large; characters, furniture, stalls, and props use small logical pixel sizes.

This is a prototype art and animation package for the Agent Orchestration IDE. It supplies PNG sprites, generated source sheets, editable SVG interface assets, atlases, animation metadata, GIF previews, and an offline viewer. The agent supervisor, provider adapters, approval system, and terminal remain application implementation work.

## 1. Quick start

1. Unzip `Kopitiam_Mini_Sprite_Pack.zip`.
2. Open `PREVIEW.html` in a desktop browser. Its images and scripts are embedded; no server or internet connection is required.
3. Select a hawker and change its simulated state. Try the independent approval overlay and reduced-motion option. These controls demonstrate assets, not live agents.
4. Import `manifest.json`, `state-map.json`, and the relevant logical-size PNGs or atlases into the IDE.
5. Use the exact frame order and anchors in the metadata. The enlarged source sheets and GIF previews are reference material, not runtime textures.

The original plan's later atmosphere work—walking, carrying, decorative customers, a shop cat, animated curtains/fan, day/night variants, and more rooms—remains a separate milestone.

## 2. Package contents

| Component | Delivery |
|---|---|
| Characters | Kopi uncle; noodle hawker with neck towel; rice-stall auntie with headscarf |
| Character frames | 252 PNGs: 84 per character, including 82 animated frames and two explicit hold frames |
| Character references | 18 PNGs: front, four diagonal views, and portrait for each hawker |
| Stalls | Kopi/kaya toast, noodle/wok, nasi lemak/rice; separate layers on a shared canvas |
| Room | Approved large background and 16 modular architectural pieces |
| Furniture/decor | Mini table, stool, plant, vase, condiments, utensil cup, menu board, picture frame, clock, static fan |
| Work/food props | 28 PNGs: documents, tools, trays, bell, ticket rail, dishes, cookware, jars and utensils |
| Effects | 26 frames: steam, stove heat, ticket arrival, dish placement, accepted sparkle |
| Interface | 64 PNG/SVG pairs: 30 icons, 20 badges, six frames, four selection overlays, four shadows |
| Metadata | File paths, atlas rectangles, timing, playback modes, anchors, hit areas and state mapping |
| Review files | Offline viewer, 38 GIF previews, source sheets, inventory CSV and validation notes |

There are 433 individual runtime/reference PNG sprites, excluding atlases, generated source sheets and preview images. This count includes layers and convenience/reference sprites; it does not mean 433 unrelated objects.

| Path | Purpose |
|---|---|
| `PREVIEW.html` | Self-contained scene, clip and asset viewer |
| `manifest.json` | Main machine-readable index |
| `state-map.json` | Normalized state → clip and status badge |
| `inventory.csv` | Inventory of room, prop, reference, effect and UI sprites |
| `characters/hawker01.json` … `hawker03.json` | Per-character clips, files, atlas rectangles and references |
| `characters/<id>/<clip>/<frame>.png` | Individual animation or hold frames |
| `characters/<id>/reference/` | Front, southeast, southwest, northeast, northwest, portrait |
| `stalls/<kopi\|noodle\|rice>/layers.json` | Layer paths, placement anchors, draw order, clickable polygon |
| `room/background.png`, `room/modules/` | Large background and modular architecture |
| `room/table.png`, `room/decor/` | Furniture and decorations |
| `props/work/`, `props/food/` | Individual small props |
| `effects/animations.json` | Effect timing, frame order and static fallbacks |
| `ui/icons/`, `ui/badges/`, `ui/frames/` | Controls, indicators and blank panels; PNG and SVG |
| `ui/selection/`, `ui/shadows/` | Focus/selection overlays and contact shadows |
| `atlases/` | Packed textures and rectangle metadata |
| `sources/` | Original generated sheets and approved artwork |
| `previews/` | Enlarged GIFs and composition checks |
| `VALIDATION.md` | Checks performed and remaining limitations |

Character appearance is independent of provider, model or job. Any hawker can code, research, test or review.

## 3. Miniature scale

All sizes below are logical pixels. Transparent padding is intentional.

| Asset | Canvas | Anchor / notes |
|---|---|---|
| Character | 32 × 40 | Feet `[16, 36]`; body approximately 28 pixels tall |
| Portrait | 24 × 24 | Session tabs, agent picker and compact lists |
| Stall layer | 96 × 80 | Shared canvas; ground anchor `[48, 76]` |
| Table | 48 × 40 | Ground anchor `[24, 36]` |
| Decoration | 32 × 40 | Base `[16, 36]`; visible objects vary in size |
| Work/food prop | 32 × 32 | Base `[16, 28]`; cups and tools are smaller than trays/pots |
| Effect | 32 × 32 | Anchor `[16, 28]` |
| Floor module | 32 × 20 | Diamond surface plus thickness; anchor `[16, 9]` |
| Wall/entrance | Varies | Read each asset's `size` and `anchor` |
| Badge | 24 × 24 | Attention layer; keep legible above the tiny artwork |
| Control icon | 16 × 16 | Put a larger clickable button around it |
| Background | 512 × 432 | Intentionally large room |

Use nearest-neighbor rendering: `context.imageSmoothingEnabled = false` for Canvas 2D and `image-rendering: pixelated` for HTML images. Prefer integer zooms such as 1×, 2×, 3× and 4×; round screen positions to whole pixels. Interface text should stay readable independently of world zoom.

Do not tightly trim character frames without preserving their offsets. Do not scale an entire generated source sheet and assume it is a correct runtime atlas. Use the exported files and rectangle data.

The approved working view is slightly overhead and front-facing. Four diagonal static reference views are included, but the work animations are not four-direction animation sets. The room retains its isometric cutaway appearance.

## 4. When to use each state

These names are a normalized visual vocabulary for your supervisor/adapter layer. They are not claims that every provider emits the same event names.

| Condition | Character clip | Badge / meaning |
|---|---|---|
| Starting | `asking` | `starting`; backend decides when startup ends |
| Idle / waiting for commands | `idle` | Neutral badge or none; stay selectable in a stable position |
| Thinking / generating | `thinking` | `thinking`; show actual activity, never invented hidden reasoning |
| Reading | `reading` | `reading`; order/recipe gesture |
| Editing | `editing` | `editing`; preparation gesture |
| Generic tool execution | `editing` | `tool` plus real command label; do not call every tool a build |
| Building | `building` | `building`; optional steam/heat |
| Testing | `testing` | `testing`; tasting/inspection gesture |
| Waiting for approval | `asking` | Amber `approval` hand; open the exact permission request |
| Waiting for an answer | `asking` | Blue `question`; open the agent's question |
| Queued | `idle` | `queued` ticket; actual queue count as UI text |
| Dependency wait | `idle` | `dependency`; show the real blocking task/session |
| Rate limit / retry wait | `idle` | `retry_clock`; use real retry timing |
| Ready for review | `review`, then `review_hold` | Purple `review` tray; output awaits review and is not accepted |
| Accepted | `accepted`, then `idle` | Green `accepted` check; optional one-shot sparkle |
| Stopping | `stopping`, then hold | Amber `stopping`; wait for runtime confirmation |
| Stopped | `stopped` | Red `stop`; static and no active-work effects |
| Cancelled | `stopped` | `cancelled`; interruption does not imply rollback |
| Error | `error`, then hold | `error`; open real failure details |
| Disconnected / stale | Freeze last reliable frame | `disconnected` and last-known label; stopped pose is fallback |
| Unknown activity | Neutral `idle` pose | Neutral badge plus “Activity unknown”; do not invent an approval/question |

Activity, blockers, connectivity and outcome are separate dimensions. When an agent is still building while another action needs approval, retain the build animation and add the approval badge. Use the raised-hand clip when the agent itself is waiting. The viewer includes this simultaneous-work-and-approval case.

`state-map.json` maps the primary visual state. Your renderer must maintain independent blocker/outcome overlays as well. A dish means ready for review; it must not receive the accepted check automatically.

## 5. Animation timing

All three hawkers use the same clips and timing. The per-character JSON is authoritative.

| Clip | Frames | ms/frame | Playback |
|---|---:|---:|---|
| `idle` | 6 | 167 | Loop |
| `thinking` | 8 | 125 | Loop |
| `reading` | 6 | 167 | Loop |
| `editing` | 8 | 100 | Loop |
| `building` | 12 | 100 | Loop |
| `testing` | 8 | 125 | Loop |
| `asking` | 8 | 125 | Once, then hold |
| `review` | 8 | 125 | Once, then hold or switch to `review_hold` |
| `accepted` | 8 | 100 | Once, then visually idle; retain accepted badge |
| `stopping` | 4 | 125 | Once, then hold |
| `error` | 6 | 125 | Once, then hold |
| `review_hold` | 1 | Static | Hold while review is pending |
| `stopped` | 1 | Static | Hold |

Playback metadata uses `loop`, `once_hold`, `once_idle` and `hold`. Duration on a one-frame hold is a placeholder; it must not time out the state.

Select frames from elapsed time, not the number of screen redraws. Restart a one-shot only for a new relevant event. A repaint, snapshot replay, selection change or reconnect should not repeatedly replay a celebration.

Each raw generated sheet contains 91 poses. Exports select 84, omitting redundant extras. `selectedSourceIndices` and frame `sourceRect` records trace exports back to source artwork. Runtime clip definitions use the exported order, not the raw sheet grid.

## 6. Assemble a stall

| File | Purpose |
|---|---|
| `back.png` | Canopy, rear posts, blank sign and shelf |
| `worktop.png` | Empty top surface |
| `front.png` | Lower foreground counter panel |
| `equipment.png` | Compact matching equipment group |
| `counter_shell.png` | Convenience combined worktop/front; use instead of the two split pieces |
| `reference.png` | Flattened appearance reference; do not draw with the modular layers |
| `layers.json` | Paths, anchors, draw order and clickable polygon |

All layers share the same top-left origin. Draw: **back → character → worktop → front → equipment → effects/status overlays**.

The character feet anchor is `[16, 36]`; the stall's `agent_feet` is `[48, 52]`. Place the character canvas at **stall origin + `[32, 16]`**. This higher placement and the compact equipment layer keep faces and raised hands visible.

| Stall anchor | Coordinates | Purpose |
|---|---|---|
| `agent_feet` | `[48, 52]` | Character feet reference |
| `work_surface` | `[48, 49]` | General worktop reference |
| `hand_prop` | `[48, 40]` | Approximate extra-prop attachment |
| `dish_output` | `[76, 49]` | Served-output prop reference |
| `ticket_rail` | `[48, 22]` | Ticket attachment reference |
| `status_badge` | `[92, 40]` | Bottom-center of badge; subtract badge anchor `[12, 24]` for top-left `[80, 16]` |

Use the hand tools, recipe and tray already present in character clips by default. Do not add a second identical tool. Additional props need contact-point checks; a single hand anchor is not an exact moving-hand attachment for every frame.

Example, assuming `draw` uses already loaded PNGs:

```js
const stall = manifest.stalls.find(s => s.id === "kopi");
const character = manifest.characters.find(c => c.id === "hawker01");
const origin = { x: 220, y: 238 };
const clip = character.clips.building;
const i = Math.floor(elapsedMs / clip.durationMs) % clip.frames.length;

draw(stall.layers.back, origin.x, origin.y);
draw(clip.frames[i], origin.x + 32, origin.y + 16);
draw(stall.layers.worktop, origin.x, origin.y);
draw(stall.layers.front, origin.x, origin.y);
draw(stall.layers.equipment, origin.x, origin.y);
// Draw independent effects, badges and real UI labels afterward.
```

Use the broad station polygon for clicking. The hawker, station, nameplate and badge should all resolve to the same stable session ID. The badge may extend outside the stall canvas, so give it a separate hit target. Do not make users click a tiny moving hand.

## 7. Room, furniture and props

The large background already includes walls, floor, entrance and windows. Use it as the starter room, or build a configurable room from modules. Do not accidentally draw a second room over the flattened background.

Modules include plain/patterned floor, border/corner, two wall orientations, corner join, cap, closed/open shutter, doorframe/open doorway, two blank signs, threshold and skirting. Test seams, grid spacing, depth order and occlusion in the final renderer before treating the illustrations as a seamless tile map.

Place the table, stools and decorations by their ground anchors and sort by ground position. Keep them outside station hit polygons. Separate contact shadows live in `ui/shadows/`.

Work props cover recipe card, order slip, clipboard, pencil, chopping board, spatula, spoon, ladle, empty/finished tray, bell and ticket rail. Food props cover kopi, kaya toast, noodles, nasi lemak, kettle, wok, lidded pot, milk tin, jar, chopsticks, strainer, rice basket, ingredient trays, banana-leaf plate, sambal and stacked cups. Reuse the lidded pot for rice or soup. The kopi equipment group contains its toast-rack dressing.

Prop canvases are consistently 32 × 32, while visible objects vary in size. Align by `anchor`, not the transparent rectangle's corner. Enlarge a menu preview separately if needed; keep world-scale files small.

## 8. Effects and interface assets

| Effect | Frames | ms/frame | Use |
|---|---:|---:|---|
| `steam` | 6 | 125 | Optional active cooking/build cue |
| `stove_glow` | 4 | 150 | Active stove heat, not idle decoration |
| `ticket_arrival` | 4 | 100 | Once for a newly queued task/instruction |
| `dish_placement` | 6 | 100 | Once when output becomes ready for review |
| `accepted_sparkle` | 6 | 90 | Once after explicit acceptance |

Read `effects/animations.json` for order and static fallbacks. Do not play accepted effects merely because a command exited successfully.

Controls include add agent, conversation, terminal, changes, queue, steer, stop, retry, approve and deny. SVG versions are editable; PNGs preserve the small grid. Give buttons accessible names and comfortable hit areas, typically 32–40 screen pixels or larger.

Blank frames include order ticket, nameplate, speech bubble, attention board, tooltip and empty agent slot. Read `nineSlice` and `contentPadding` from `ui/assets.json`. The speech bubble has a tail and is not marked as nine-slice; separate the tail if your renderer stretches the bubble dynamically.

Names, task titles, queue counts, timers, terminal contents and commands stay actual interface text. Never bake changing information into the artwork. Keep keyboard focus visible and avoid relying on color alone.

For reduced motion, use the idle/resting frame for continuous activity, the raised-hand hold for a waiting request, the review hold for pending review, and the error hold for failure. Suppress nonessential effects while keeping badges and labels visible.

## 9. Atlases and runtime integration

Each character atlas is 384 × 280: twelve columns by seven rows of 32 × 40 exported frames. This differs from the generated 13 × 7 source sheet. Use the atlas rectangles in character metadata.

Effect atlases contain the exported sequence for each effect. Shared world/UI atlas JSON records rectangles by asset ID. Use those values rather than guessing from preview images.

For a character at world foot position `(x, y)`, draw at `(x - 16, y - 36)`. For other objects, subtract their recorded anchor. Use nearest-neighbor sampling; shared atlases include transparent gutters.

Keep responsibilities separate:

- Supervisor/adapters own activity, lifecycle, outcomes, pending requests, connectivity and queues.
- A visual resolver chooses the primary clip and independent overlays from that snapshot.
- A renderer owns texture lookup, elapsed animation time, positions, hit testing and reduced motion.
- Conversation/terminal panels retain stable session identity when a hawker is selected.

Animation completion must never approve an action, resume a session, run queued commands or mark work accepted. Stopping must retain the supervisor's queue-hold behavior. A disconnected sprite does not imply that the underlying process stopped.

## 10. Validation and limits

See `VALIDATION.md` for checks actually performed. Exports separate source sprites, normalize frame canvases and feet positions, establish hard alpha edges for illustrative PNGs, and record explicit frame order. UI shadows/selection overlays intentionally retain partial alpha.

This is a prototype asset set. Generated poses retain some frame-to-frame facial, outline, prop and shading variation. Fixed canvases and anchors reduce placement drift; they do not prove artist-polished loops. Review playback at the intended game scale and refine distracting poses before release.

The source sheets are included for editing. The color family is consistent, but the pack is not a single rigorously indexed 20–28-color palette. Architectural modules still require final placement/seam checks. Test labels, occlusion, keyboard use, and simultaneous work-plus-approval against real adapter events before shipping.

## 11. Next implementation milestone

Connect one hawker and stall to real supervisor events first. Verify idle, generation, reading, editing, tool use, builds, tests, approval, answer-needed, queued, review, accepted, stopping, stopped, failure and connection loss. Then use the other two skins for additional stable sessions.

After those interactions work, add the original plan's optional walking/carrying, customers, shop cat, ambient motion and more rooms. Decoration must not resemble actual agent activity or obstruct the controls.
