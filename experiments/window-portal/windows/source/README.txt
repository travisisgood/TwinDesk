Standalone Windows source, wire v1

This source is separate from TwinDesk's window transport. Its transport.js and
wire.js are derived from reviewed Mac standalone c8f2bff, using its injected
worker/display hooks. Windows changes: skip GUI startup blank lines, diagnostic
failure records, and delete an expiring pairing file only if its token still
belongs to that source instance. A random local named pipe connects the Windows
GUI capture worker; GUI stdin cannot be assumed to remain connected.

Capture: Chromium window capture -> PNG, one selected native window only. No
desktop stream. Native helper restores the original source on pipe loss, with
an independent guardian for helper failure. Source checks whole-window containment
before starting. Oversized windows are refused, not silently clipped or resized.
Fixture input is a scoped standard-button message; other sources currently
advertise NO input until real app-specific behavior is verified.

Backing monitor is created/adopted once by BackingMonitor. The KVM bridge in
windows/portal-backing-bridge.js must acknowledge the same unique local request
before source relocation. It uses existing native appDisplay and JS setAppDisplay
exclusions; refuses physical monitors or an active older display session. Window
return/close does not disable the monitor. End the explicit backing session only
after sources have returned. Physical KVM map observed as three displays with
DISPLAY35 excluded; normal mouse crossing still requires a live user check.

Run: node main.cjs <private source config JSON>. Required local config paths:
nativeHelper, displayProbe, electron, kvmProfile, output, pairingFile. Set fixture
true or supply sourceTitle exactly; also sourceCommit full SHA, host, port,
durationSeconds (15..900). LAN requires certFile/keyFile. Pairing secret is created
after listener setup, valid five minutes, one use. Never print/commit pairingFile.
Exchange it encrypted with the receiver's ephemeral public key.

Local test:
node loopback-test.cjs <private pairing file> <source output> <receiver SHA>
At2475aa9:10 frames,5 distinct PNGs; button count0->1 via button-invoke. Capture
image inspected. The fixture occupied482x301 fully inside1440x900 backing display.
These are local results, not yet Windows->Mac paired acceptance or Explorer input.

