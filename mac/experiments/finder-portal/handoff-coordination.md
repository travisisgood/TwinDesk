# Standalone edge handoff (paired activation pending)

Windows accepted this schema in WINDOWS_HANDOFF_REVIEW_ACCEPT_86. Its updated
primitive reportedly has seven tests passing; the broker, live KVM adapter and
paired crossing are still outstanding.

Review target: Windows coordination-relay f7dc899 receiver/handoff-state.cjs.
Placement preserves normalized grab position, including negative monitor origins.
Commit checks source session/window/revision, destination geometry, button held,
first frame and deadline. These checks are appropriate; this is not a live KVM
integration. The bounded 128-entry replay cache must be complemented by a broker
session epoch/monotonic sequence. A peer wall-clock deadline should become a
locally measured bounded TTL to avoid clock-skew failures. Binding only destination
geometry does not detect changed source edge maps; bind both layout revisions.

Proposed authenticated broker messages, separate from current window streams:

- `offer`: `{id, sessionId, windowId, geometryRevision, sequence, ttlMs,
  sourceLayoutRevision, destinationLayoutRevision, displayId,
  entry:{edge,offset}, anchor:{x,y}, drag:{id,button:0,held:true},
  pointerOwner, ownershipEpoch}`. UUID offer/drag IDs; monotonic sequence per
  authenticated broker session; TTL 1..5000 ms measured from local receipt.
  Edges are destination left/right/top/bottom; offset and source-window grab
  anchor are normalized 0..1, logical display geometry, never backing geometry.
- `ready`: same identity/revision/drag/epochs plus `frameSeq` actually decoded and
  destination bounds. Receiver stages a hidden proxy and records recovery state.
- `commit`: same offer identity and expected ownership epoch; source rechecks
  physical topology/button/drag, parks source on backing, and grants receiver
  pointer continuation for the next epoch exactly once. Receiver shows only the
  native window. Source rendering ownership remains on source OS throughout.
- `committed`: confirms new epoch and actual visible bounds; retries are
  idempotent and never replay a down. Receiver continues its native window drag
  using the original grab anchor, with an explicit button-up ending continuation.
- `abort`: correlated identity plus reason. Timeout, released button, topology
  change, capture failure or disconnect cancels staging and releases owned input.
  Source alone restores its window to surviving physical source bounds; receiver
  alone discards its staged proxy. Disconnect after commit uses the same recovery.

The source retains a recovery lease until commit acknowledgement. No second
owner may accept pointer input during an uncertain transition. If acknowledgement
is lost, terminate the transfer and recover rather than infer ownership. Reverse
handoff uses a new offer/drag identity with the same source window identity; it
never turns the receiving proxy into a new source capture.

Mac owns physical source-edge observation for both native and Windows-injected
mouse paths. Existing mac/kvm.js callbacks at edge and driven return already
receive native helper `moving`; inspect/extend the helper signal to preserve grab
anchor and held state before cancelling its native move loop. Do not wire the
standalone transfer into the legacy move-window handler until paired broker and
rollback tests pass. Windows owns receiver placement and pointer continuation.
No shared files or main TwinDesk wire changes are implemented here.


## Mac source broker candidate

`edge-broker.js` is a finite, explicitly launched local runtime, separate from
TwinDesk. It warms one backing display, adopts an existing Finder window only
after its normal title drag reaches the configured physical edge, and sends
`PORTAL_SESSION1 open` through the authenticated local messenger. Pairing is
encrypted to the locally configured Windows public key. It never sends credentials
in logs, runs received commands, or invokes a model. It ignores outbound echoes
and starts at the current message cursor; loss of peer/history aborts recovery.

Its private config requires `connectionFile`, `settingsFile`, `peerPublicKey`,
`output`, `durationSeconds` (30..3540), `side`, and `source` (the existing TLS source
config with capture path, exact sourceCommit, host/port and cert/key files). The
broker verifies legacy Apps > Move windows is off and side matches KVM. That
legacy switch was disabled through the normal Mac UI; KM remains enabled.
Do not enable a second display owner while the current paired source is active.

Open includes requestId, monotonic sequence persisted per local messenger
instance, sourceCommit, encryptedPairing, appId, ttlMs, sourceLayoutRevision, and
pointerOwner. Topology fingerprints map to increasing integer revisions. The
source checks sessionReady against its authenticated source identity and actually
received frame ACK before offering the agreed handoff. Stale identity/layout,
release before commit, timeout, capture loss and disconnect stop the source; a
late asynchronous startup is closed without publishing pairing. A local injected
up when Windows owns the physical mouse is deferred to Windows' real held-button
check, because KVM ends its injected Mac drag when returning the pointer.

The source worker can end the original Finder move loop with one PID/window-
targeted up before parking, and preserve the drag-start home bounds for recovery.
No down is synthesized for that operation. This native path still needs a real
held-drag test; the earlier emergency-release API test does not prove drag handoff.

Twenty-two automated tests pass, including source-authoritative ACK state and
five source transaction/cancellation tests. Signed edge candidate build passed.
The observer and broker remain unvalidated for paired natural dragging. Windows
6db6bb6 currently rejects pointerOwner=windows and lacks correlated cancel in its
bootstrap gate; these were sent as review103. Native receiver held-drag ownership
and staged show are still required before activation. Main TwinDesk/shared wire
and Windows files remain untouched.
