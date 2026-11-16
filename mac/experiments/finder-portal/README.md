# Standalone Finder window capture experiment

This is an isolated native command-line probe, not a TwinDesk build or integration.
It imports no TwinDesk code and creates no displays, network sessions, event taps,
or global input. It deliberately does **not** implement window transfer or input.

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
Each image is saved with SHA-256, Vision OCR text, current window listing/onscreen
state, bounds, and intersection with existing displays.

For visible, requested offscreen, minimized, and restored phases:

1. Save a baseline before creating the phase-specific marker file.
2. Create a uniquely named file while the source remains in that state.
3. Save three more snapshots, separated by two seconds, and OCR the new filename.
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

## Actual Mac validation, 2026-11-15

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
