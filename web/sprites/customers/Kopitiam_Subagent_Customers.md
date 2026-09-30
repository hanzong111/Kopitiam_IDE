# Kopitiam Agent IDE — Customers as Subagents

Version 1.0 · 30 September 2026 · Addendum to the Kopitiam Agent IDE Sprite Production Plan

## The visual idea

**The stall owner is the parent agent. Each customer is one subagent that the owner has called.** A customer enters from the bottom of the scene, walks toward the stall, and sits on a stool in front of it. The customer always faces away from the viewer and toward the stall owner. Clicking the customer opens that exact subagent's conversation, activity, output and controls.

These are functional subagent avatars, not decorative NPCs. Create them from confirmed subagent sessions or runs. Do not create a customer for every tool call, terminal command, model token or unconfirmed spawn request.

Five appearances are supplied. They are visual choices, **not a five-subagent limit** and not fixed roles or capabilities. Assign a stable appearance to each child and use a live name/short ID to distinguish reused appearances.

## Included artwork

| ID | Appearance visible from behind | Useful distinction |
| --- | --- | --- |
| `customer01` | Jade T-shirt, short dark hair, navy bottoms | Plain rounded hair and green back |
| `customer02` | Coral top, dark ponytail, cream bottoms | Ponytail and warm coral silhouette |
| `customer03` | Mustard headscarf, teal clothes, dark bottoms | Large mustard headscarf |
| `customer04` | Teal cap, cream/navy striped shirt | Cap adjustment strap and horizontal stripes |
| `customer05` | Grey hair with low bun, plum cardigan | Grey bun and purple back |

All five are miniature sprites compatible with the existing 32 × 40 character canvas. The original generated sheets are deliberately enlarged for reference; use the exported frames or atlases in the IDE.

| Deliverable | Quantity / format |
| --- | --- |
| Customer identities | 5 |
| Unique customer frames | 80 transparent PNGs: 16 per customer |
| Customer atlases | 5 PNGs, each 128 × 160 |
| Shared stool | 1 transparent PNG, 32 × 40 canvas |
| Shared status badges | 20 PNGs, reused from the core pack |
| Animation previews | 30 GIFs, six clips per customer |
| Source artwork | 5 original generated customer sheets, prompts, and original stool export |
| Runtime metadata | `manifest.json`, `state-map.json`, and one JSON per customer |
| Preview | `PREVIEW.html`, self-contained and usable offline |
| Guide | This file, included in the ZIP |

The demo also contains a few existing stall, owner and table assets for context. They are not new customer designs. This is a standalone add-on; it does not replace the earlier core ZIP or production plan.

## Animation contract

Every source/atlas uses four columns and four rows, read left to right, then top to bottom. Atlas coordinates use the top-left origin. Frame indices are zero-based.

| Clip | Indices | Timing | Playback | When to use it |
| --- | --- | --- | --- | --- |
| `walk_north` | 0, 1, 2, 3 | 130 ms/frame | Loop | Customer travels toward the stall |
| `sit_down` | 4, 5, 6, 7 | 120 ms/frame | Once, hold last | Customer reaches its reserved seat |
| `seated_idle` | 8, 9, 10, 11 | 280 ms/frame | Loop | Quiet seated activity while badges show actual state |
| `raise_hand` | 12, 13, 14, 15 | 140 ms/frame | Once, hold last | Approval, answer or error requires attention |
| `stand_up` | 7, 6, 5, 4 | 120 ms/frame | Once, hold last | A resolved/closed customer is leaving |
| `lower_hand` | 15, 14, 13, 12, 8 | 120 ms/frame | Once, hold last | Attention is resolved; return to seated state |
| `standing_hold` | 4 | Static | Hold | Standing without walking |
| `seated_hold` | 8 | Static | Hold | Paused, complete, stopped or reduced-motion state |
| `attention_hold` | 15 | Static | Hold | Attention still required |

`stand_up`, `lower_hand` and the hold clips reuse existing frames; they do not add to the 80 unique-frame count. The 1000 ms value on a one-frame hold is metadata compatibility only, not an instruction to leave that state after a second.

Four-frame clips give a compact retro cadence. They are not 24-frame smooth animation. The raised hand should remain up while the request remains unresolved, rather than wave repeatedly forever.

## From spawn to completion

1. **Confirmed child creation:** register `(childSessionId, runId)` under its parent. Give it a stable customer ID, appearance and seat reservation. Make it selectable immediately.
2. **Arrival:** play `walk_north` while moving up the screen along its entrance lane. A short 600–1000 ms arrival is sufficient. Show real status immediately, even while it walks.
3. **Seat:** when its world position reaches the reserved anchor, play `sit_down` once, then render its current backend state.
4. **Working:** stay seated. Use `seated_idle` plus the actual activity badge and live label. The body motion indicates presence, not hidden reasoning or invented progress.
5. **Attention:** raise a hand for an approval request, a question or an error. The badge and text distinguish them. Selecting the customer opens the relevant request in its session panel.
6. **Result ready:** use a purple review badge and a still seated pose. Keep the customer visible so the user or parent can inspect the result. Completion is not automatically acceptance.
7. **Accepted/closed:** after an explicit result-consumed, accepted or session-closed event, show the accepted state. If that subagent is being retired, play `stand_up`, then fade it out over approximately 200–300 ms and free the seat. Keep the session in history.

Animation timing never gates backend work. A child can finish before reaching its seat: shorten or skip the remaining entrance, display its real outcome, and keep its result accessible. If a live child remains available for further commands after completion, leave it seated instead of removing it.

Only north/back walking is supplied. The exit fallback is **stand, then fade**. Do not reverse the north walk to make it moonwalk toward the viewer. A physical walk-out through a bottom/side doorway needs additional directional artwork.

## Backend states and visual states are separate

The event names below are proposed normalized application events, not claims about any provider's exact API. Translate the provider's real session, tool, approval and completion events in your adapter.

| Backend state or condition | Pose after arrival | Badge / label | Behaviour |
| --- | --- | --- | --- |
| `starting` | Seated idle | Starting | Child exists but has not begun useful work |
| `running` | Seated idle | Running/tool | Use when finer activity is unavailable |
| `thinking`, `reading`, `editing`, `building`, `testing` | Seated idle | Corresponding activity | Only use activity reported by the runtime |
| `idle` | Seated idle | Waiting for command | Click to give this child a follow-up |
| `queued` | Standing hold if not seated | Queued | Backend execution queue, not a shortage of visual seats |
| `dependency_wait` | Seated hold | Waiting for dependency | Keep the customer and its relationship visible |
| `rate_limited` | Seated hold | Retry scheduled | Display retry information only if supplied |
| `needs_approval` | Raise hand, then hold | Amber approval | Show the exact pending action in the child panel |
| `needs_answer` | Raise hand, then hold | Blue question | Direct the user's answer to this child |
| `ready_for_review` | Seated hold | Purple review | Result is available, not yet accepted |
| `accepted` | Seated hold | Green accepted | Departure is allowed only if the child is retired |
| `stopping` | Seated hold | Stopping | A stop request has been sent; wait for acknowledgement |
| `stopped`, `cancelled` | Seated hold | Stop/cancelled | Keep the reason accessible; dismiss explicitly |
| `error` | Raise hand, then hold | Error | Retain the customer for retry or inspection |
| `disconnected` | Freeze last reliable frame | Disconnected | Freeze position too; do not assume completion |
| `unknown` | Neutral seated hold | Activity unknown | No guessed activity or fake progress |

`state-map.json` is a visual lookup, not a workflow engine. In particular, if a backend-queued child is already seated, retain `seated_hold` instead of abruptly standing it up. Seat shortage must not change a running child's status to `queued`.

Approvals and questions can coexist with ongoing activity. Store attention separately from activity: a pending request may add the raised hand and badge while the text still says “Building.” Resolving attention returns to the latest activity, not necessarily idle. Error and disconnection take precedence over optional decorative motion.

## Placement, stool and draw order

| Property | Value |
| --- | --- |
| Customer frame | 32 × 40 logical pixels |
| Ground anchor | `[16, 36]` in every frame |
| Atlas grid | 4 × 4 cells; each cell is 32 × 40 |
| Atlas size | 128 × 160 |
| Source/atlas orientation | Back view, facing north/up the screen |
| Stool frame / anchor | 32 × 40 / `[16, 36]` |
| Preferred sampling | Nearest-neighbour; integer scaling |
| Suggested badge placement | Its bottom-centre at customer ground + `[20, -34]` |

For a seat ground position `(x, y)`, draw the stool and customer canvases at `(x - 16, y - 36)`. Draw the stool first. The customer exports already include the seated elevation: walking/standing feet reach local y=36; sit-down frames lift them by 0, 1, 2, then 4 pixels; seated and attention feet reach y=32. **Do not add that lift a second time.** `seatLift` is informational metadata describing the baked placement.

The smaller stool was exported from the approved core stool artwork. Its seat surface is approximately `[16, 26]`; the customer contact point is approximately `[16, 27]`. This one-pixel overlap keeps the body visibly seated. Contact points are approximate for this stylized artwork, not a rigid physical rig.

Draw the room and stall assembly first. Within a seating group, draw the table, then stools, then customers, then badges, selection indicators and live labels. Use ground-position sorting across independent groups. Do not apply a single global “customers always on top” rule if you later add foreground architecture.

Place the table above the customers on screen so their backs face the viewer and their attention faces the stall. Reserve enough spacing for raised hands and badge hit areas. Two seats separated by about 32–36 logical pixels are a useful starting point for the existing 48-pixel table. Add a second table or a visible overflow group instead of shrinking characters as the population grows.

Atlases have no gutter pixels. Disable texture filtering and mipmaps when sampling them. For integer source rectangles:

```js
const sx = (frameIndex % 4) * 32;
const sy = Math.floor(frameIndex / 4) * 40;
ctx.imageSmoothingEnabled = false;
ctx.drawImage(atlas, sx, sy, 32, 40, x - 16, y - 36, 32, 40);
```

Render with the intended world scale or an integer-scaled canvas. Do not smooth the 32 × 40 PNGs, display the enlarged source sheet as a single character, or rescale each animation frame to its own visible bounds.

## Interaction and usable orchestration

- Clicking or keyboard-selecting a customer opens that child's session, not its parent's terminal. Show the parent name and task relationship in the panel.
- Keep the selected customer highlighted while it moves or changes status. A small moving sprite should not be the only way to find a session: mirror every child in an accessible list/tree.
- Show live name, task title, status and elapsed time outside the artwork. Do not bake those into sprite PNGs. Use readable labels and roughly 40–44 screen-pixel click targets even if the artwork is much smaller.
- Route follow-ups, stop, retry and approval actions using immutable child session/run IDs. Do not route by customer colour, seat index or list position.
- Preserve the current seat while the child is alive. Sort changes, new events and reconnects must not shuffle existing customers.
- Five appearances may be reused. Persist an assignment when first creating the visual entity, rather than recomputing a different appearance when the list order changes.
- Seat capacity is a layout choice, separate from backend concurrency. If there is no seat, show the child in a labeled overflow group and keep its actual running state. A visible “+N subagents” control opens the complete list.
- For grandchildren, preserve `parentSessionId` and the full task tree. They can share the root stall's seating area with relationship labels; do not silently turn a nested subagent into an unrelated stall owner.
- Stop on a customer targets that child. Stopping a parent does not visually imply all children stopped; wait for each runtime's actual outcome.
- In reduced-motion mode, show a seated still immediately, keep status changes and focus cues, and use `attention_hold` for requests. Never require watching an animation to discover an approval.

## Minimal data model and event rules

```ts
type CustomerVisual = {
  customerId: string;
  childSessionId: string;
  runId: string;
  parentSessionId: string;
  rootStallId: string;
  variantId: string;         // customer01 ... customer05
  seatId: string | null;    // null means visual overflow, not backend queued
  activity: string;
  attention: null | { kind: 'approval' | 'question' | 'error'; requestId: string };
  resultState: 'none' | 'ready' | 'accepted';
  visualPhase: 'arriving' | 'sitting' | 'seated' | 'standing_up' | 'fading' | 'hidden';
  lastSequence: number;
};
```

Treat child creation and seat reservation idempotently. A duplicate spawn event must not create a second customer. Reject stale updates according to the adapter's sequencing contract, and reconcile with an authoritative snapshot after reconnect. Snapshot restoration should place existing customers directly into their current poses instead of replaying every historical arrival.

Keep `visualPhase` independent of `activity`. Animation completion may advance “sitting” to “seated”; it must never mark work complete, approve an action, accept a result or cancel a task. Releasing a visual seat must not delete the child's session or output.

If a parent view is closed while children remain active, retain them in a visible background-task/overflow list. Do not delete live customer entities merely because their stall is off screen. A retry can reuse the same appearance, but attach it to the runtime's new run identity and reset transient attention safely.

## Files and quick start

1. Open `PREVIEW.html` to see the five customers arrive and sit. Its controls simulate states; it does not connect to agents or send commands.
2. Choose `atlases/customer01.png` through `customer05.png`, or the individual PNG frames under `customers/`.
3. Read `manifest.json` for frame rectangles, anchors, clip timing and shared assets.
4. Add `shared/stool.png` at each seat. Shared badges are optional if your IDE already renders equivalent accessible status UI.
5. Connect your supervisor's normalized events to the behaviour described above. Keep execution, attention, output acceptance and visual movement separate.

`previews/customer_lineup.png` shows standing, seated and attention poses in three rows. GIF previews repeat loop clips; non-loop clips play once. The HTML preview is the easiest way to replay arrival and status transitions. Prompts and unmodified generated sheets in `sources/` support future art iteration.

## Scope and known limits

This delivery contains artwork, metadata and a local visual preview, not an implemented agent supervisor. The generation used the built-in image tool, with the approved miniature hawker as a style reference and customer01 as the shared pose reference. The original sheets are preserved; PNG slicing, nearest-neighbour sizing and atlas/GIF assembly are deterministic exports.

The generated poses retain some small outline, hair, hand and clothing variations. The fixed canvases, common scale and seated anchors reduce placement drift but do not make the loops artist-polished. Inspect at your intended display scale before shipping. No front-facing, side-facing, diagonal walking, eating, typing or physical walk-out sprites are included. The seated pose plus a reliable badge intentionally carries most backend activity states.
