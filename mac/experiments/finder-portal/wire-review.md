# Mac review of standalone wire v1

Reviewed proposal: `coordination-relay`
`9c2f9cfd7504674fe2059935aaa03cc6a5fba964`,
`docs/window-portal-wire-v1.txt`. Mac implementation checkpoint:
`b3861fb98e6534c1104d0d68b4bcd0a2287ae94c`.

The overall contract fits the Mac experiment. No networking implementation or
shared-file edit is included in this review. Both directions must use the same
contract. This is conditional agreement pending the clarifications below.

## Requested exact clarifications

1. **Loopback authentication:** the proposal permits `ws://127.0.0.1`, but says
   the single-use secret is accepted only over pinned TLS. State explicitly:
   loopback-only test mode accepts the same expiring single-use secret over ws,
   with the server bound only to 127.0.0.1 and rejecting non-loopback peers;
   all LAN connections require wss and the pinned certificate. Alternatively,
   require pinned TLS for loopback too and remove the ws exception. Never
   silently downgrade TLS after certificate failure. Consume the secret
   atomically on successful authentication; no second session can reuse it.
2. **Input rejection versus teardown:** malformed envelopes, invalid IDs,
   non-increasing sequence numbers and protocol bounds violations close the
   session. Well-formed but stale geometry, unsupported capability, or queue
   saturation returns `inputResult` with `rejected`/`unsupported`, without
   executing or replaying the action. Advance the input sequence even when
   such an action is rejected. An unknown/unsent frameSeq is a protocol error.
   Clarify this distinction against the blanket 'reject invalid messages and
   close session' rule. This prevents an ordinary click during a metadata
   update from unexpectedly returning the source window.
3. **Commit identity and frame geometry:** explicitly define hello.sourceCommit
   as the receiver build's full commit, welcome.sourceCommit as the source
   build's full commit (the existing field names can remain). Require every
   frame pixelSize to match the current window metadata pixelSize for that
   geometryRevision, and associate each sent frame sequence with its geometry
   revision. Frame ACKs must identify the single outstanding frame. This makes
   the paired report and stale-input checks deterministic on both platforms.

## Mac implementation constraints

The source must authenticate before capturing or moving any window. The backing
holder can be created separately as explicit setup and retained after individual
session teardown. The current 180-second display-holder lifetime is only a bounded
local experiment; a paired controller must restore every owned source before
intentional holder exit. Unexpected holder loss must stop input and trigger source
recovery. Controller-crash recovery on the new backing path still needs a live test.

Finder's current supported input is Accessibility-based press/search, not generic
raw mouse/keyboard. An AX success yields `dispatched`, never `verified` without an
observed application change. The raw process-targeted click failed in live testing.
The first endpoint must advertise only implemented operations; source title-bar
management buttons remain blocked. Menus, dialogs, drag gestures, and arbitrary
applications are separate capability work.

The current Mac right-edge geometry is a local fixture. It is not an agreement
about the user's Windows/Mac adjacency. No network code should infer physical
layout from the fixture. Both endpoints must record the explicit frozen rectangles
and units, source SHAs, and wire version for a paired acceptance run.
