# Standalone Finder window capture experiment

This is an isolated native command-line probe, not a TwinDesk build or integration.
The original `run.py` minimized/offscreen experiment creates no displays. The
separate `backing_test.py` now tests the user-approved persistent backing-display
design, using the existing private display API header. Neither creates network
sessions, event taps, or global input. It does not implement network transfer. The optional native viewer experiments
with window-scoped Accessibility presses; general input is not implemented.

Windows reference inspected: `window-only-poc` at
`0033a84c9aed2c351f23c50e2238c64ce0db6fc6`,
`experiments/window-portal/windows`. Windows reports fresh synthetic WinForms
snapshots offscreen but **failed real Explorer content updates**. That report is
not a Mac result.

## Build and run

macOS 14+, Xcode command-line tools, and Python 3 are required. From repository root:

```sh
MAC_IDENTITY='your existing signing identity' \
  mac/experiments/finder-portal/build.sh /absolute/output/finder-portal
```

Keep this bundle path and signing identity stable between builds. Without
`MAC_IDENTITY`, the script uses ad-hoc signing, which may require renewed grants.
No existing TwinDesk bundle, profile, entitlements, or security settings are changed.

The executable is inside `Finder Portal Probe.app/Contents/MacOS/` in that output.
Check permission with `FinderPortalCapture --permission`. Opening the standalone app
also requests its normal permission. After the user approves,
`FinderPortalCapture --request-permission` invokes the normal macOS Screen Recording
request. The user must grant access in System Settings; the probe never modifies TCC.

```sh
python3 mac/experiments/finder-portal/run.py \
  '/absolute/output/finder-portal/Finder Portal Probe.app/Contents/MacOS/FinderPortalCapture' \
  /absolute/output/finder-results
```

The runner creates its own uniquely named test folder and Finder window, never
selecting a pre-existing personal window. Finder automation permission is also
required. A separate bounded watchdog restores that window if the runner dies;
normal completion restores it and stops the watchdog. The test folder and window
remain available for inspection. No user files are removed.

## What is measured

A separate Swift process selects the exact Finder title and bundle ID once, retains
its `SCContentFilter(desktopIndependentWindow:)`, and takes successive
`SCScreenshotManager.captureImage` snapshots. It never recaptures the whole screen.
Each image is saved with SHA-256, current window listing/onscreen
state, bounds, and intersection with existing displays.

For visible, requested offscreen, minimized, and restored phases:

1. Save a baseline before creating the phase-specific marker file.
2. Create a uniquely named file while the source remains in that state.
3. Save three more snapshots, separated by two seconds, and inspect the new filename in the PNGs.
4. Restore the disposable source before moving to the next phase.

A hash change alone is not proof. Inspect the PNGs and confirm the newly created
filename is absent before mutation and present afterward. For an offscreen claim,
require the recorded bounds to be wholly outside every existing display. macOS may
clamp Finder bounds; that is an unsupported placement, **not** an offscreen pass.
For minimized testing require `collapsed=true` and the original absent from the
screen. Use the restored phase as a control for a stale hidden snapshot.

These are periodic screenshot freshness measurements, not a sustained SCStream
frame-rate measurement. A capture pass proves neither process-targeted mouse input,
keyboard input, popups, source invisibility during input, nor arbitrary plugin
support. Those need separate experiments. No input is injected here.

## Initial Mac validation, 2026-11-15

- Compiled the standalone Swift capture executable successfully on macOS 27.2.
- Python syntax and shell syntax checks passed.
- Separate Developer ID app bundle built and strict signature verification passed.
- Signed-bundle permission preflight also reported false; runner stopped before
  creating or moving any Finder window and saved a blocked result.
- First Finder automation attempt timed out (`-1712`) before capturing any samples.
- Direct ScreenCaptureKit enumeration failed with `SCStreamErrorDomain -3801`,
  “The user declined TCCs for application, window, display capture.”
- Consequently **no visible/offscreen/minimized/restored freshness test has passed
  or failed yet**. Permission denial is a test blocker, not a capture limitation.
- No TwinDesk rebuild, source integration, display creation, or KVM changes.

Apple API references:
- https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)
- https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(contentfilter:configuration:completionhandler:)

## Completed live run after permission grant, 2026-11-15

Screen Recording access became active after the user restarted Codex. Finder
AppleEvents then responded. The probe needed AppKit initialization before SCK;
Vision OCR also stalled beyond the sample timeout, so it was removed from the
capture path. Saved PNGs were inspected directly instead; `markerSeen: null`
means no automated OCR assertion was made.

The signed rebuild retained permission. One complete 16-snapshot run exited 0:

| State | Observed result |
| --- | --- |
| Visible | New `VISIBLEPROOF.txt` appeared in the capture. |
| Requested offscreen | Finder clamped x to -760 for an 800-point window, leaving 40 points visible. `OFFSCREENPROOF.txt` appeared, but **fully offscreen capture remains unproven**. |
| Minimized | **Fresh content confirmed.** `MINIMIZEDPROOF.txt` was absent in minimized-0.png and present in minimized-2.png, created between those captures. All minimized samples reported Finder collapsed=true and SCK onScreen=false. No restoration occurred between the two captures. |
| Restored | `RESTOREDPROOF.txt` appeared; Finder returned to {100,100,800,550}, collapsed=false. Normal cleanup succeeded. |

Measured hashes and states are recorded in `observed-results.json`. Raw PNGs and
full local results are retained in the workspace outputs/finder-portal-verified
folder, not committed. This is one actual Finder list-view test on macOS 27.2,
using periodic screenshot capture. It is not proof of continuous video performance,
input into a minimized window, arbitrary applications, or network transfer.
No input injection, TwinDesk build/integration, or virtual display was involved.

## Native viewer and click follow-up

`run.py --viewer` opens a standalone Cocoa proxy. `--press Name` invokes the exact
AX Name control; `--click 0.35,0.12` exercises normalized pointer mapping through
the same handler used by the proxy mouse event. `--hold 45` leaves a bounded
45-second period for real proxy mouse tests while the source stays minimized.
The runner restores the source afterward. Accessibility access is required;
`--accessibility` and `--request-accessibility` query/request the normal OS grant.

Actual follow-up observations on 2026-11-15:

- SCStream at requested 15 fps stopped producing complete frames while Finder
  was minimized: all four minimized samples remained at frame 357. A new filename
  appeared in SCScreenshotManager output, but was absent from the stream image.
- The viewer therefore uses serialized repeated snapshots while minimized (250ms
  delay after capture, not a guaranteed 4fps). Its stream resumes when visible.
- Name-column AXPress returned success, changed ascending to descending order,
  and reported minimizedAfter=true. Saved proxy images showed the changed order.
- Normalized pointer routing to the Name header passed. A real CUA mouse click
  inside the native proxy then changed it back to ascending. The after-manual
  snapshot still reported source onScreen=false and minimizedAfter=true.
- The final run generated 162 fallback snapshots, reported no capture errors,
  and restored the source successfully. An earlier overlapping-snapshot run
  reported transient -3811 on restoration; snapshot calls are now serialized.
- These observations verify one accessible control and sampled source visibility,
  not arbitrary keyboard/mouse events, transient-visibility absence between
  samples, popups, child windows, network input, or all Finder controls.

Proxy images are saved alongside requested samples as `.png.stream.png`; despite
that historical suffix they contain whichever image the viewer currently displays
(stream or snapshot fallback). All source-window movement, fixture creation, and
cleanup remain isolated from TwinDesk. General keyboard events are not forwarded; the later search-only keyboard test is below.

## Search input, navigation and recovery follow-up

Actual CUA keyboard test: clicked the proxy search field, typed `minimizedproof`
as individual native key events, then pressed Return. Finder search results
appeared in the proxy. The after-manual sample reported source onScreen=false,
minimizedAfter=true, 208 fallback snapshots and no capture error. Source restoration
succeeded afterward. The viewer implements this using AXValue and AXConfirm on
the source search field, **not** arbitrary process/global key injection. Text input
is limited to that field, printable characters, backspace, Command-A replacement,
and Return; general shortcuts, selection, IME and other editors are unsupported.

Search activation, programmatic text assignment and AXConfirm also passed
separately. A transient -3811 snapshot error still occurred during one restoration
transition despite serialization; subsequent visible stream frames resumed.
Serialization does not eliminate all transition errors.

Navigation results:
- AXOpen on a disposable child folder restored the original Finder window.
  **Failed hidden-source requirement.** AXOpen is disabled in the normal helper;
  `--open-child` now checks that refusal rather than repeating the unsafe behavior.
- Finder-specific `set target of Finder window id ...` reached PortalChild and
  captured CHILDPROOF.txt while collapsed=true/onScreen=false. This is a narrow
  application scripting result, not generic navigation or interactive double-click
  support. `--script-child` reproduces that isolated fixture test.
- Proxy presses are restricted to validated types of controls; unsupported actions
  return an error rather than falling back to global input. Only Name and Search
  received individual live interaction tests; other sort headers use the same AX
  path but are not independently validated.

Real failure tests (`recovery_test.py <binary> <output> helper|controller`):
- SIGKILL of our capture helper while its fixture was minimized: restored in 2.895s.
- SIGKILL of our controller, preventing its finally block: independent guardian
  restored the source in 1.695s. The result was recorded before test cleanup.
Both measured the original bounds {100,100,900,650} and collapsed=false. These are
local process-failure tests, not network disconnect tests.

`--viewer --quick --local-minimize` exercises receiver-only minimize/restore.
The regular native viewer sets the Finder application icon; actual Dock appearance
must be checked separately from programmatic NSWindow state. `--quick` runs only
the minimized phase. `--hold` is bounded at 60 seconds, and helper exit during that
period now causes prompt controller cleanup.

Receiver-only minimize/restore live test passed: viewerMinimized changed false ->
true -> false while every source sample remained collapsed=true/onScreen=false.
Fallback frames advanced from 10 to 28; cleanup restored the source. The disabled
AXOpen command returned its capability error without exposing Finder. This tests
local receiver window state, not a paired Windows taskbar/Dock interaction.

## Aspect ratio, normal close, and raw-input diagnostic

A 500x700-point proxy displayed the 800x550 source with letterboxing. Actual CUA
clicking its scaled Name header changed ascending to descending order; source
remained offscreen/minimized in the after-manual capture. Margin clicks are
rejected by the image bounds calculation. Use `--resize 500,700 --hold 45` for
this bounded manual test.

`--close-viewer` now exits the native helper when its proxy closes. The controller
detects that normal exit and restores the source; an actual close test exited 0
with viewerClosed=true and restored=true. The controller also watches for helper
exit during the bounded interactive hold.

A separate `--raw-sort` diagnostic posted one balanced left down/up pair with
CGEvent.postToPid and both explicit window-under-pointer fields targeting the
fixture. Finder remained minimized and the measured physical cursor position did
not move, but **sort order did not change**. This raw-input path failed the action
test; it is not a normal viewer capability and is never a fallback for AX input.
It says nothing about raw keyboard support. The source code is retained solely
as a reproducible bounded diagnostic.


## Persistent backing-display experiment (architecture revision)

The user explicitly approved persistent backing displays with **individual window
receivers only**. Previous minimized/offscreen evidence remains intact. No
whole-desktop stream, TwinDesk integration, or shared protocol change is included.

```sh
python3 mac/experiments/finder-portal/backing_test.py \
  '/absolute/output/finder-portal/Finder Portal Probe.app/Contents/MacOS/FinderPortalCapture' \
  /absolute/output/backing-results
```

`FinderPortalBacking` owns one 1280×900 display for this bounded session (180-second
maximum), placed to the right of the existing display union. It verifies existing
display geometry is unchanged and that the new display is independent, not mirrored.
The holder retains the display across source returns, re-parking, and capture-process
exit. It removes it only on session exit/EOF/timeout. The test restores its own
Finder fixture first; an independent guardian covers controller disappearance.
This is session persistence, not a login service or permanent OS display.

Capture uses the individual Finder window filter. The backing-mode receiver is
borderless, so there is no second Mac title bar around the captured Finder window.
Explicit scale-to-fit fixes blank padding when a 1× backing display feeds a 2×
configured stream. Input is permitted only while the selected fixture is wholly
inside the expected experiment display; no input action relocates the source.
The original minimized-mode guards remain in place when no backing ID is supplied.

Actual Mac tests: Finder remained at (1480,60), 800×550 on the backing display,
while the physical display stayed at (0,0), 1440×900. A newly created
`BACKINGLIVEPROOF.txt` appeared in the native receiver's **SCStream image**, visually
inspected against its absent baseline. Stream frames advanced and snapshot fallback
count stayed zero. Returning to (100,100) and re-parking retained the same display
ID and topology. Receiver-only minimize/restore preserved source placement.
Accessibility Name sorting succeeded. The process-targeted raw mouse diagnostic
still did not change the sort, so general mouse input remains unsupported.

`--fail-holder` kills only the experiment holder to exercise source restoration.
The injected holder-termination run restored the fixture to its original physical
bounds through controller cleanup; unexpected controller death in backing mode
is not yet live-tested. Normal capture EOF left the holder display unchanged.
Measured sanitized results are in `backing-results.json`; images and full logs
remain in the local output directory.

Limitations: private macOS display API, fixed right-edge arrangement and resolution,
one disposable Finder window, no network transfer or automatic edge dragging,
no owned-popup capture, no general raw keyboard/mouse, no receiver title-bar button
routing, and no paired Windows validation. The standalone test has no KVM layout
map; filtering the backing display from TwinDesk's physical map remains integration
work. Crash recovery measurements for the original minimized experiment must not
be treated as proof for this new architecture. No Scarlett/audio settings changed.


Peer review at this checkpoint: fetched `coordination-relay` at `1aa368a` and
read its revised architecture note, `window-only-poc` remains `0033a84`, and
`windows-network-monitor` is `89c2072`. The shared note still lists old Mac
checkpoint/evidence below its superseding design paragraph. Sent updated evidence
through the relay; did not independently edit shared coordination or Windows files.
Windows' source-display reuse and this experiment's retained holder are compatible
in lifetime intent. Exact peer layout negotiation and isolated transport remain
unagreed/unimplemented, so fixed right-edge placement is only a local test choice.

## Standalone network endpoints (wire v1)

The review amendments are accepted in `coordination-relay` at `ce24665`.
`source.js` and `receiver.js` now implement that contract locally, using the
existing Mac `ws` dependency; no root configuration or TwinDesk protocol changed.
`source_worker.py` starts the signed helper only after successful authentication.
The headless source creates a dedicated Finder fixture on the retained backing
display; it never opens a local desktop viewer. Source metadata includes the real
`com.apple.finder` bundle ID and a PNG generated from the installed Finder icon.

Use an existing Node runtime (in Codex, `$CODEX_MCP_NODE_PATH`) and private JSON
config files outside the repository. Example source config keys:

```
{capture: absolute signed FinderPortalCapture path,
 output: private experiment output directory,
 sourceCommit: full source build commit,
 host: "127.0.0.1", port: 49731,
 pairingFile: private local JSON path, durationSeconds: 120}
```

This is an illustrative field list, not literal JSON. Start with
`node mac/experiments/finder-portal/source.js /private/config.json`.
For LAN, explicitly set the local host address, `certFile` and `keyFile`.
TLS 1.2+ and an exact SHA-256 DER certificate pin are mandatory. Self-signed
certificates are accepted by the receiver only after exact pin comparison,
before sending hello or its token; mismatches never fall back to unpinned TLS.
The generated pairing file contains a random single-use 256-bit token and is
written with mode 0600. Never print it or include it in a chat, log, or commit.

Receiver config: `capture`, `pairingFile`, `sourceCommit` (receiver build), optional
`resultFile`. Run `receiver.js` with that private config. It launches a borderless
native AppKit window after metadata arrives, validates decoded image dimensions,
and acknowledges only installed frames. The remote app's PNG becomes the Dock
icon. Command-M minimizes locally; Command-W closes the receiver and returns the
source. These shortcuts are local window actions, not source keystrokes. Search
text/Return are the only keyboard capability; generic keyboard, window dragging,
menus, and popup forwarding remain unimplemented.

One outstanding frame, latest native image only, max 16 pending source inputs,
strict sequence/identity/bounds validation, 2-second transport heartbeats and
6-second liveness/frame-ACK deadlines are enforced. A token cannot be reused;
reconnection is not automatic. Current endpoint accepts one authenticated session
per explicit source launch. Display lifetime is separate from that connection:
receiver close restores Finder but leaves the holder up until explicit source
shutdown or its configured finite lifetime. Source duration defaults to 120s,
maximum 900s; holder lifetime is source duration plus 30s. The holder's original
standalone default remains 180s (configurable 30..3600s).

Tests:

```
node --test mac/experiments/finder-portal/{wire,source}.test.js
node mac/experiments/finder-portal/source-live-test.js CAPTURE OUTPUT COMMIT
node mac/experiments/finder-portal/source-live-test.js CAPTURE OUTPUT COMMIT kill-worker
node mac/experiments/finder-portal/native-loopback-test.js CAPTURE OUTPUT COMMIT tls
node mac/experiments/finder-portal/native-loopback-test.js CAPTURE OUTPUT COMMIT wrong-pin
```

Actual pre-commit development validation on this Mac: 6 protocol/socket tests
passed. Real Finder streamed 12 frames over authenticated loopback; the newly
created NETWORKLIVEPROOF marker was visually absent then present. An AX click
was dispatched with Finder still at backing coordinates (1480,60); disconnect
restored (100,100). Killing the Python worker with SIGKILL also restored the
source through its independent guardian. A real native receiver over pinned TLS
decoded 16 frames, reported completed AppKit minimize then restore notifications,
and source restoration passed. Wrong pin: 0 frames, no source fixture/capture,
no token consumption. These are local tests, **not paired Windows acceptance**.
An initial immediate-state minimize assertion failed; reporting now uses actual
AppKit completion notifications, and the rerun passed.

Outstanding: paired TLS exchange/Windows native receiver acceptance, independent
controller-failure cases beyond the tested worker kill, negotiated physical layout,
automatic edge dragging, general input, owned windows and production lifecycle.
No claim that this experimental endpoint replaces TwinDesk or Deskflow yet.

### Physical map and first paired run

The next holder identifies as `TwinDesk Window Finder Portal (Experiment)`, vendor
0x4d53/product 0x4d54 with distinct experiment serial 0x4650. This matches the
existing Electron label exclusion and native Screens parking-display category.
Source input additionally checks the experiment serial, so it cannot target an
unrelated TwinDesk backing display. The standalone build compiles the existing
`Screens.swift` unchanged to measure its real physical-map result. Optional source
`backingOrigin:{x,y}` specifies frozen placement; overlap is rejected. Reading the
saved Mac KVM configuration found Windows on the left, along 0. A real pinned-TLS
run at (-1280,0), 1280×900 kept the physical map at only (0,0), 1440×900, decoded
16 frames and completed receiver minimize/restore. This checks the actual helper
filter; the running TwinDesk app itself was not rebuilt or instrumented.

Source `events.jsonl` records authentication (build ID only), first/every-100th
frame ACK, input operation/status, and teardown reason. It never records tokens,
search text or images. Receiver pin verification now precedes even HTTP upgrade,
aligned with the reviewed Windows receiver implementation.

First paired LAN run: Mac source `15d6498`, Windows receiver `73ec108` (peer report
PAIRED_RESULT_25). Windows reports 691 decoded/displayed frames over 120 seconds,
local minimize at frame 15 and restore at frame 27, and user screenshot confirmation
of Finder over the Windows desktop. The receiver ended normally at its test
boundary. Mac independently measured source restoration to (100,100), 800×550,
not minimized. The source fixture contained NETWORKPAIREDPROOF after connection,
but Windows did not inspect a later marker snapshot or exercise input before its
deadline. Therefore paired changing-content, input and taskbar-logo acceptance
remain outstanding. The first run used the original right-side test backing;
the corrected left-side/excluded candidate requires a separate paired run.
