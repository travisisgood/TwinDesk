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

Paired follow-up evidence is now in `paired-results.md` and `paired-results.json`.
It distinguishes Mac measurements from Windows' native UI observations.

Following that paired run, `pressAt` on an already-expanded Finder Search field
now uses AXFocused instead of requiring AXPress. This is restricted to a source
still wholly on the experiment backing display; minimized-source behavior is
unchanged. Real `backing_test.py --search-focus` passed: AX focus returned success,
backingAfter stayed true, query text and results appeared in the captured window,
and normal return/re-park/receiver-close restoration still passed. The paired
checkpoint predates this fix, so do not retroactively attribute it to that run.

### Native receiver shell

`build.sh` also produces `Window Portal Receiver.app`, with stable bundle ID
`com.travismackinnon.windowportalreceiver` and the same signing identity. It only
decodes received images and needs no Screen Recording grant. `receiver.js` finds
this sibling bundle automatically, or accepts an explicit `receiver` executable
path. The capture app retains its existing identity/grants; headless source mode
uses accessory activation and does not add a duplicate Dock icon.

The receiver has normal app activation and Window-menu Minimize/Return to Source
commands. Its invisible centered 30%-width, 8-point-high top strip supports local
receiver dragging, matching the Windows prototype caption region. This repositions
the proxy only; it does not move the source or backing display and is not automatic
edge crossing. Local drag before/after frames are recorded in receiver test results.
The standalone receiver's separate identity also prevents UI automation from
confusing it with the source's headless process.

Actual native receiver shell test: after selecting the visible app by absolute
bundle path, CUA dragged its caption. Native event telemetry measured origin
(160,120) → (260,70), size unchanged at 800×550. The stream completed 600 frames,
no source input was sent, and the source restoration check passed. The first
`performDrag` approach had returned without moving the window; explicit local
mouse tracking corrected it. Several short test runs ended before UI selection;
those were not counted as drag passes. A later manual Dock-shortcut follow-up
also outlived its bounded test and is not claimed as a verified UI shortcut.
Native minimize/restore completion is separately covered by the TLS test.
`receiver-shell-results.json` records measured movement and recovery.

Protocol/socket coverage now also verifies queue overflow rejects the 17th input
without teardown/replay, and an unacknowledged frame ends the session despite
continuing valid heartbeats. Nine automated tests pass, including encrypted
pairing authenticity and tamper rejection.

### Windows fixture compatibility

`peer-fixture-test.js WINDOWS_FIXTURE CAPTURE OUTPUT COMMIT` runs the unchanged
Windows `experiments/window-portal/windows/receiver/fixture.cjs` against the real
native Mac receiver. Resolve `ws` for the external fixture with
`NODE_PATH="$PWD/mac/node_modules"`. The reviewed fixture came from
`b81cabc58c1c69688ffb94eae61d0907066d6582` on `coordination-relay`.
The local run passed: one authenticated hello, 16 decoded/acknowledged frames,
`test.fixture` identity, and native minimize/restore completion. Result files are
removed before each run so stale output cannot pass a new test. This synthetic
loopback check does not establish real Windows capture, application interaction,
or paired Windows-to-Mac acceptance.

Receiver result files now retain the source's advertised full commit and the
receiver commit separately, plus the count of distinct compressed PNG hashes
whose native decoding completed (bounded to 1024 unique hashes). The unchanged
Windows fixture produced 16 distinct decoded frames in the 16-frame test.
Different hashes are supporting transport evidence, not proof of a specific
application change: paired acceptance still requires inspecting the content.

For explicit capture tests, optional local `evidenceDirectory` saves `first.png`
after the first native decode acknowledgment and `final.png` at close, containing
the last acknowledged frame. Only one latest decoded PNG is retained in memory;
the directory/files are created with private permissions. These are remote source
image artifacts, not screenshots of the Mac desktop. Leave this option unset for
ordinary sessions. They can establish source content changes while the Mac is
locked, but cannot verify native Dock appearance or interactive receiver behavior.

November 16 Dock attempt: paired Explorer source `64680e7` / receiver `3d8041a`
delivered 5066 frames, but the receiver recorded no minimize events despite menu
and shortcut attempts. User saw a small window; Dock/icon acceptance did not pass.
The session ended at the source's scheduled cutoff, not a demonstrated minimize
failure or source recovery triggered by minimize. The next candidate routes the
menu directly to `miniaturize` instead of `performMiniaturize`, and gives small
sources a preferred 900-point local width bounded by 90% of the available screen.
Source size and protocol coordinates are unchanged. Signed build passes; actual
menu/Dock behavior remains pending. A local UI check was interrupted before its
menu action could be verified and is not counted as a pass.

In the subsequent real Explorer session, Travis supplied a photo and confirmed
the Explorer folder Dock icon looks correct. This is user-observed icon acceptance,
not minimize/restore acceptance. He also reported excessive zoom and no working
interaction. The forced 900-point initial enlargement is therefore removed;
initial sizing now only shrinks to fit. This does not establish correct Windows
DPI-to-Mac-point mapping or improve the source image resolution. That mapping and
broader Explorer input remain coordinated work with Windows. The active session
was left intact while preparing this correction.

### Actual Finder source resize

Windows accepted `resize` with `{logicalSize:{width,height},pixelScale}` in
coordination message 70. Finder now advertises it on the backing display. The
source drains outstanding frame ACKs, serializes input, reads back AXSize and
unchanged backing position, restarts capture, and increments geometryRevision
only after a matching capture arrives. Density-only changes also increment it.
Old-frame input cannot claim a new revision; queued stale input is rejected.
The Mac receiver suppresses input between new metadata and the first decoded
frame of that revision. Receiver-originated Mac resize UI is still pending.

The backing display now requires an actual 1280×900-point / 2560×1800-pixel mode.
The first attempt incorrectly supplied physical dimensions as the HiDPI mode and
failed closed. The corrected mode uses logical dimensions, matching
[Chromium's native implementation](https://chromium.googlesource.com/chromium/src/+/c301827d24af4b3f60178b09db6c8c1f61ad5829/ui/display/mac/test/virtual_display_mac_util.mm).
No physical monitor geometry or KVM map is changed. Output scales above native
2× are resampled; more encoded pixels do not prove additional rendered detail.

Real local `resize-live-test.js` passed 900×600 at 2×, 640×480 at 1×, 800×550 at
3×, then a density-only 800×550 at 1.5× (revisions 2 through 5). Source bounds
remained on the same backing display. Old-frame input was rejected; 1400×700
exceeded the backing and was refused without changing revision. Disconnect
returned Finder to (100,100), 800×550, and the test closed only its own fixture.
`resize-local-results.json` contains measurements. Eleven automated protocol,
socket and envelope tests pass; signed native builds pass. These are local tests,
not paired Windows receiver acceptance or proof of arbitrary application resize.

Paired follow-up: Windows reported source `f57954d` / receiver `4ccd147` grow and
shrink acceptance. Mac independently logged revision 2 as 813×550 points with
1220×825 pixels, and revision 3 as 800×550 with 1200×825 pixels. Current source
bounds read back as (-1240,60), 800×550 on the backing display. Windows visually
observed a Name-header sort change; subsequent unsupported presses are not counted
as normal input. Sharpness and general interaction remain open.

### Finder toolbar drag regions

The source now advertises the agreed `sourceDragRegions` capability. Regions are
derived from the selected Finder's actual AXToolbar, subtracting interactive
controls with two points of padding, rather than guessing a centered strip.
Rectangles are bounded, nonoverlapping and limited to 32. Changes to these regions
trigger a new geometry revision between acknowledged frames, including when the
source window size itself is unchanged. Capture and source placement are retained.

`drag-regions-live-test.py CAPTURE EXISTING_SESSION OUTPUT` reads only the selected
test Finder's native metadata/AX controls. It verified the title center is inside
a drag region, nine measured toolbar controls are excluded, and regions do not
overlap. `drag-local-results.json` records that result. Twelve automated tests
pass. This does not establish paired native titlebar dragging, automatic edge
handoff, or matching regions for arbitrary applications. Windows performs the
next receiver drag test; the Mac source-side edge detector remains Mac-owned work.

First paired drag attempt (`ed99bef` source / `eafa4e2` Windows receiver) delivered
400+ acknowledged frames but Windows reported unchanged receiver bounds after its
CUA drag. No drag pass is claimed. Windows fixed per-frame replacement of native
drag-region DOM nodes for the next attempt; screenshot-to-DIP coordinate mapping
also needs checking at its 150% scale. Mac independently verified source recovery
at the scheduled cutoff: (100,100), 800×550, not minimized. Source logs now retain
the exact advertised drag rectangles/revisions for comparison with receiver hits.


## Native pointer diagnostics and drag checkpoint (2026-11-16)

Windows relayed the user's successful native Finder title-text drag in
WINDOWS_USER_TITLE_DRAG_PASS_81: source `8e62c220d1086f828c6856fb30afd65ef011f439`,
receiver `049dd7f`. This supersedes the inconclusive automated drag attempt above;
it does not establish controls, natural edge transfer or arbitrary window support.

`native-pointer-test.py CAPTURE FRESH_OUTPUT` runs a bounded real Finder fixture
on its own backing display, then verifies physical restoration and closes only
that fixture. `native-pointer-results.json` records eight negative pointer probes:
raw PID events, AX window focus, AppKit window-number events, explicit window tags,
window-local location, window-server PID routing, opposite local Y origin, and
app activation plus focused window. None changed the Name sort direction. Source
bounds and cursor were unchanged in every probe. A separate AXPress positive
control changed ascending to descending, validating the observation. The active
app probe restores the previously active app; no source is moved physical to
inject input. These are diagnostics only, never advertised capabilities.

Some variants dynamically resolve private APIs and fail closed if absent. They
are not a proposed production dependency. The window-location declaration is
also present in [WebKit's test SPI header](https://github.com/WebKit/WebKit/blob/main/Tools/TestRunnerShared/spi/CoreGraphicsTestSPI.h).
The AppKit coordinate distinction is documented in
[Chromium's event test utility](https://chromium.googlesource.com/chromium/src/+/720dadbc215c229ce100bc408edb3aee03b0697e/ui/events/test/cocoa_test_event_utils.mm).
Neither source establishes that Finder accepts this route on a backing display.

Signed standalone source/receiver build passed; 12 existing transport/geometry/
pairing tests passed with loopback socket permission. Full TwinDesk was not rebuilt.
Normal pointer, wheel, dragging, key and text capabilities remain unimplemented.
The next useful input investigation is receiver-side native event observation to
separate event delivery from AppKit focus/hit-testing, followed by actual Finder
selection/navigation; more successful semantic header clicks are not sufficient.
See `handoff-coordination.md` for the Windows primitive review and pending broker
contract. No shared, Windows or main TwinDesk wire files were changed.


### Follow-up: native ordinary clicks and navigation now proven locally

`native-pointer-delivery-results.json` shows event-posting permission granted and
both marked down/up events arriving through a listen-only per-Finder-PID tap.
Only marked diagnostic events are retained; this is not a keyboard listener.
AppKit window number is zero for the original raw CGEvents, and correct for
window-addressed AppKit events. AX focused/main window readbacks match the target.
A Command-modified background click first changed the sort direction, but this
cannot substitute for ordinary selection because Command changes semantics.

`native-pointer-ordinary-results.json` then established an ordinary unmodified
click: activate Finder, focus its backing window, stamp both global position and
**top-left window-local position**, post window-addressed down/up to Finder PID,
then restore previous application focus. Earlier active-app tests incorrectly
used bottom-left local coordinates. The source never moves physical for input.
The implementation currently depends on dynamically resolved private window-
location SPI; it is not a claim of compatibility across macOS versions.

`native-pointer-navigation-results.json` records actual Alpha.txt selection,
replacement with Beta.txt (not multi-selection), and double-click navigation into
PortalChild. Every action kept source bounds (-1240,60,-440,610) and cursor (0,885)
unchanged. Normal recovery and fixture closure passed. These are **local native
source tests**, not paired receiver tests. Source focus leasing, held-input
release, wire dispatch and receiver mouse events must be implemented/tested before
advertising pointer support. Wheel, keys, text, owned menus/dialogs and natural
edge handoff remain outstanding. No general input capability is advertised yet.


### Integrated pointer candidate

The standalone source now advertises `pointer` and `releaseAll` only when the
native backing-window input route and post-event permission are available.
It infers double-click count from button, monotonic time and point distance,
leases Finder focus across held buttons, and restores prior focus after up.
It never applies a forced Command modifier. A native watchdog releases owned
buttons after eight seconds without source heartbeat; stdin EOF releases before
helper shutdown. Source disconnect and resize release before physical recovery.
If the capture helper exits during a held down, the pipe owner launches a recovery-
only helper that can send ups to that exact source PID/window before restoration.

`pointer-live-test.py` passed actual source-worker Alpha selection, replacement
with Beta, folder double-click, explicit release, and deliberate capture SIGKILL.
The emergency up API returned success and physical restoration was read back;
this does not independently observe AppKit consumption of the emergency up.
The test closes only its own restored fixture. Fourteen automated tests pass,
including stale-frame/geometry release, identity/replay checks, saturated input
queue release, and cancellation of queued pre-release downs. Signed build passed.

Wire additions are the previously agreed optional standalone operations only;
main TwinDesk/shared wire is untouched. Paired Windows input and natural edge
handoff remain required. Wheel/key/text and owned popup handling are not claimed.


### Actual paired input and next speed/wheel candidate

Windows report93 visually confirmed Alpha selection, Beta replacement and
PortalChild opening on receiver36e90f9/source7cf62c44. Report96 relayed Travis's
successful use of Finder to launch Claude, with severe latency. Mac read back
unchanged backing bounds during the session and normal physical recovery on its
15-minute cutoff. This is paired interaction evidence, not natural edge crossing.

Windows identified per-input proof screenshots as a major receiver cost and
removed them. Mac now retains the source focus lease until releaseAll/blur,
removing repeated 80ms activation waits and 60ms per-up delays. Source logs include
native frame duration and input queue/total time. Config `captureScale:1` offers a
lower-pixel-count comparison; 2 remains default. Do not claim latency fixed until
the new paired build is measured. Sessions may now be explicitly bounded to up
to 3540 seconds; the next candidate uses 1800 seconds.

The wheel handler passed a real Finder test: vertical AX scrollbar changed from
0 to 0.4898 after positive-down input, source bounds and physical cursor unchanged,
and releaseAll cleared the focus lease. Pointer selection, navigation and forced
helper-exit recovery passed again after the focus optimization. Sixteen automated
tests passed. `wheel` is advertised; keyboard/text remain off.

Agreed Windows contract100 adds `receiverWindowControls` and genuine AX-derived
`windowControls` rectangles. Close means return home, minimize means local Windows
taskbar, zoom means receiver maximize/restore with the existing resize route.
The Mac sends close (18,18,16,16), minimize (41,18,16,16), zoom (64,18,16,16) for the
measured Finder window; these are measured per window, not hard-coded metadata.
Validation rejects out-of-bounds, duplicate-action and drag-region overlaps.
Paired behavior of these controls remains to be tested.

Existing-window adoption is implemented for explicit Finder IDs and tested with
an already-existing 640x480 window: original bounds (130,150,770,630) restored,
folder contents unchanged, no generated files in the adopted folder. The new
read-only `--observe-edge SIDE SECONDS` observer is an isolated draft that emits
Finder title-drag anchor/physical-edge information, distinguishing TwinDesk-injected
mouse events. It is not connected to KVM or the broker, and automatic crossing is
not yet validated. PORTAL_SESSION1 bootstrap and PORTAL_HANDOFF1 integration are
being coordinated with Windows. The current paired candidate uses explicit
pairing while that work continues.


### Keyboard, owned menus and capture speed candidate

The native backing-window test now verifies ArrowDown changes Finder selection,
Command-F opens search, committed Unicode text reaches the search field, and
releaseAll clears a held Shift and focus lease without moving the source or
physical cursor. The signed final candidate repeated that test; evidence is in
`keyboard-local-results.json`. Source advertises optional `key`/`text` operations
using the agreed physical USB-HID mapping (Windows key maps to Command; no implicit
Ctrl/Command swap). Normal release, watchdog and helper-loss recovery include
owned keys. Helper-loss key-up API dispatch is not independent proof that AppKit
consumed it. Seventeen protocol/queue tests passed; signed standalone build passed.

With `includeOwnedPopups:true`, capture uses an explicit window allowlist on the
backing display: source plus intersecting elevated windows belonging to its PID.
A live Finder Action menu was visibly captured only after adding its explicit
window ID; includeChildWindows alone did not suffice. Pointer targeting resolves
these popup windows and retains the down target for up. Capture is clipped to the
source canvas; outside-canvas popups, unrelated child windows and sheets remain
unproven. No desktop video or audio capture is enabled. Paired popup interaction
and keyboard acceptance remain required.

The frame path avoids TIFF conversion, traverses only Finder toolbar controls for
drag geometry, skips unchanged native frames and replaces the 100ms pump delay
with 10ms bounded checks. It requests up to 30fps; actual moving-content throughput
must be measured on both endpoints before claiming a speed improvement.

Windows reports actual paired Applications navigation, wheel scrolling and local
yellow-control taskbar minimize/restore on Mac0463c09/Windowsbf5bfad. Green only
stretched that old receiver and menus were missing. Reviewed Windowsc0edef9: it
explicitly queues maximize/unmaximize resize, preserves source capture density
and logs rejection. A remaining limit is the 1280x900 backing display with source
parked at40,60, allowing at most1240x840; receiver maximize may exceed it. That
requires coordinated backing-size negotiation or an explicit fit policy, not a
claim of successful source resizing. Natural cross-edge bootstrap remains work
in progress. Main TwinDesk/shared files and Windows source are unchanged.


### Nonblocking popup filter refresh

Owned-popup enumeration/filter updates now run asynchronously with capture-
generation guards instead of holding the native frame request/reply pipe. Resize
invalidates old refresh work; failures still terminate capture rather than broaden
its allowlist. This targets the 200–400ms input stalls observed around menu changes.
Signed build passed. An eight-second read-only probe of the existing paired source
returned 470 requests (one fresh frame while idle), mean5.3ms/p95 6.9ms, without
changing focus or content. It does **not** measure popup transition latency or
paired input improvement; those remain live acceptance checks.
