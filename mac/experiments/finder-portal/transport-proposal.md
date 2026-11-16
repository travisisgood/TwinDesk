> Superseded by the mutually accepted wire v1 in coordination-relay ce24665.
> Retained as design history; implementation follows wire v1, not this draft.

# Isolated Window Portal transport review proposal

DRAFT for Windows review. No network implementation or change to TwinDesk's
existing protocol is implied. Reviewed shared goals at coordination-relay
`baa750e6541ee0463aeb2c042ec076882b90d7ea` on 2026-11-15.

Use one independently launched source and one receiver, one selected window per
session. Source creates a fresh opaque session/window ID; never accept native
window IDs or arbitrary app IDs from the receiver. Pin both source commits and a
separate schema version in each paired test record.

Proposed concrete starting format: WebSocket, JSON control messages and base64
PNG frame messages at the prototype's low frame rate. Before LAN operation use
TLS with explicit locally paired certificate pin and a one-time pairing secret;
never log or commit that secret. Local codec tests can use loopback. TLS/pairing
implementation and exact field names require agreement before either side codes.
Do not silently downgrade to unauthenticated or unencrypted LAN operation.

Suggested message types:

- hello: version, opaque session ID, protocol capabilities.
- window: opaque window ID, source bundle/stable app ID, title, logical width and
  height, pixel width and height, PNG app icon, supported input operations.
- frame: window ID, monotonic sequence, PNG bytes, pixel dimensions, capture mode.
- frameAck: last displayed sequence. At most one frame in flight; discard older
  pending frames and retain only the newest. Never build a video FIFO.
- input: window ID, monotonic sequence, operation, validated arguments. Return
  inputResult with supported/applied/error; API success is not semantic success.
- close: reason, followed by source restoration and receiver proxy shutdown.

Suggested initial bounds: control <=16KiB; frame <=8MiB decoded compressed bytes;
width/height <=4096 and total decoded pixels <=8 million; icon <=512KiB and 512px.
Validate JSON shape, base64 length, PNG dimensions before decode, finite numeric
coordinates in [0,1], sequence order, session identity, and capability membership.
Reject unknown operations, unknown windows, duplicate/replayed inputs and invalid
frames. No shell commands, scripts, native handles or paths in remote inputs.

The first Mac capabilities must describe what was actually proven:

- pressAt(normalized x,y): source resolves to a validated AX control (initially
  Name/Size/Kind/Date Modified headers and Search). It refuses arbitrary controls.
- setSearchText(text): specific source search field only, bounded text length.
- confirmSearch: the source search field's AXConfirm, not a global Return key.
- Finder navigation is separate, application-specific and not a generic key/mouse
  capability. AXOpen restores Finder and is disabled. Window-target scripting
  navigated a disposable child folder while minimized, but is not wired into the
  proxy's interactive double-click handling yet.

Receiver accounts for letterboxing and backing scale; it does not send coordinates
for borders or outside the image. Receiver minimize/restore must not close the
source session. Receiver shell owns the taskbar/Dock identity and source app icon.
No claims about IME, arbitrary keyboard shortcuts, drag/drop, menus, owned popups,
REAPER or Scarlett until separately tested.

Local heartbeat is ordinary transport code, not AI polling. On connection loss,
a bounded timeout, decode failure, source-capture failure, or quit, terminate the
session and restore the source. An independent source guardian must restore even
when its controller dies. Reconnect gets a new ID; old callbacks cannot re-hide
or inject into recovered windows. Receiver displays stale/disconnected state
rather than leaving a frozen image apparently interactive.

Review request: Windows should confirm or revise these limits, framing, input
capabilities and disconnect lifecycle before either platform implements networking.
