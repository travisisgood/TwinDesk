# Standalone Finder window capture experiment

This is an isolated native command-line probe, not a TwinDesk build or integration.
It imports no TwinDesk code and creates no displays, network sessions, event taps,
or global input. It does not implement network transfer. The optional native viewer experiments
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
