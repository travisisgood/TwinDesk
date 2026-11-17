# Resize and density contract — Windows accepted

Accepted in `WINDOWS_ACCEPT_RESIZE_CONTRACT_70`. Finder source resize is now
implemented in the standalone Mac experiment. Source drag regions and general
input remain separate unfinished capabilities; neither is advertised by Finder.

This proposes an opt-in extension to the standalone experiment only. It does not
change TwinDesk's existing wire protocol, shared files, or Windows implementation.
Both originating app icons now have user confirmation: Explorer in the Mac Dock,
and Finder in the Windows taskbar (Windows relay `UNIFIED_USER_WINDOW_BEHAVIOR_66`).
That does not establish minimize/restore, normal input, sharp scaling or resizing.

## Current findings

- Finder metadata is fixed at startup: logical size in macOS points, capture at
  two pixels per point. Frame requests reject a changed source size. Resizing the
  receiver currently changes the viewport only.
- Windows previously sent physical DWM dimensions as logicalSize. Those cannot
  be treated as receiver points/DIPs without accounting for source window DPI.
- Mac's old `Apps.resize` sets AXSize, but reports AX API success without reading
  back the resulting size. That is not proof of actual resize. `Deck.frame` also
  raises/activates the source and changes position; do not reuse that behavior for
  a crossed window merely to resize it.
- Existing `mac/pcapps.js` sends a source-size request after receiver resize.
  Investigate that path with Windows for the prior Focusrite behavior, but do not
  port its assumptions or claim a fixed-size application's content can reflow.

## Proposed minimal opt-in operation

Advertise `resize` only when implemented and tested. Use the existing input
envelope/sequence/result and add `op:"resize"` with
`args:{logicalSize:{width,height},pixelScale}`. Dimensions are positive integer
source-independent logical units: Mac points and Windows 96-DPI DIPs. Suggested
pixelScale range 1..3, finite; it is requested capture pixels per logical unit,
not a promise that rendering at that density is supported. Keep existing pixel,
area and PNG-size bounds; reject unsupported density or oversized requests.
This name/shape needs explicit Windows agreement before implementation.

The receiver translates its available content area to logical units, excluding
any local margins. It coalesces live resize locally and sends at most one request
at a time. Do not stretch an old frame and describe that as a source resize.
During the transition, letterbox the last acknowledged image and suspend input.

The source serializes resize with input, drains any outstanding old frame ACK,
then sets the actual source window size without activating, restoring, or moving
it to a physical screen. Read back position and size after bounds settle; confirm
whole-window containment on the same backing display. A clamped result is the
actual applied size, never the requested size. Fixed-size or rejected requests
return unsupported/rejected with the previous geometry intact. If partial failure
leaves uncertain geometry, recover the source and end the stream.

After applying a supported size/density, discard old capture buffers, reconfigure
capture, and wait for a frame matching the applied size. Send existing `window`
metadata with the same windowId, geometryRevision incremented exactly once,
actual logicalSize and actual pixelSize, followed by frames at that revision.
The receiver should reconcile to applied size without creating a resize loop.
No separate resize-result schema is needed: metadata gives applied geometry and
inputResult gives operation status. API success alone is `dispatched`, not
`verified`; record readback/frame evidence separately.

## Revision and input invariants

New metadata must not cause input based on the old displayed image to carry the
new revision. Resume only after installing the first new-revision frame. Source
validation must associate frameSeq with its geometry revision, not merely accept
any sequence less than the latest. Reject queued old-geometry input after resize;
do not replay it. Frame sequence remains monotonic across revisions.

General pointer/keyboard and drag-region capabilities require a separate agreed
contract. Normal titlebar regions must come from source geometry/controls and
exclude buttons; the current arbitrary centered 8-point strip is insufficient.
Do not enable unsupported operations or restore a source for input injection.

## Required paired tests

Verify actual source bounds and recaptured dimensions for grow/shrink, minimum
size clamping, fixed-size refusal, Retina and mixed-DPI receivers, and sharpness
at the negotiated density. Verify stale-frame input rejection, no resize echo,
disconnect during resize, helper failure recovery, and unchanged physical KVM
geometry. Recheck source icons and local minimize/restore independently.
