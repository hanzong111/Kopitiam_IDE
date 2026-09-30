# Export validation

Validated 30 September 2026.

## Passed

- 433 individual runtime/reference PNGs exist and contain visible content with transparent surrounding pixels.
- All 252 character frames are 32 × 40 with the visible foot baseline at y = 36 (exclusive bottom bound).
- Every character supplies 84 exported frames in the documented clip groups.
- All illustrative runtime PNGs use hard 0/255 alpha; SVG-based UI shadows and selection overlays intentionally permit partial alpha.
- All 433 atlas rectangles reproduce their corresponding standalone sprites, within a one-level rounding tolerance for compositing.
- All state mappings reference existing clips and badges.
- All stall layers use a 96 × 80 canvas and the documented anchors.
- The updated production-plan copies inside and outside the package are identical.
- 38 GIF previews were exported from the PNG sequences.
- The offline viewer's JavaScript passes syntax checking.
- 390 playback-helper checks cover each character/clip at start, intermediate, boundary and later times, with reduced motion on and off.
- The stall-layer composite and a full room composition were visually inspected. Character and equipment placement was adjusted to keep faces visible.

## Limits

- Interactive browser execution was not completed in this environment: Chromium was unavailable and its download failed. The viewer is self-contained; open PREVIEW.html locally to inspect the controls and playback.
- Checks of file dimensions, anchors and atlas pixels do not establish artist-polished animation. Some generated poses retain face, outline, prop and shading variation; inspect loops at the intended game scale before release.
- Modular architecture requires seam, grid-placement and occlusion checks in the actual renderer.
- No live agent backend is connected. Real approval, stop, review, accepted and disconnection behavior must be tested during IDE integration.
- Walking, customers, a shop cat, ambient animation and additional rooms are deferred milestones, as documented in the production plan.

Machine-readable export results are in `validation.json`.
