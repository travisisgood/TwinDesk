# Windows network-monitor work

Branch: `windows-network-monitor`, based on `network-monitor`.

## Ownership and integration

Windows agent owns `windows/`, `windows-helper/` and this file. Mac agent owns
`mac/`, `mac-helper/` and `docs/mac-network-monitor.md` on `mac-network-monitor`.
Neither agent changes shared protocol, root configuration or the other's files
without coordination. The integration branch is `network-monitor`; do not merge
the platform branches into it independently.

## First implementation increment

The one-to-one Windows screen sender now refuses to substitute Mirror when
Extend is requested without a ready virtual display driver. The local error
explains the prerequisite; installation still takes place on Windows. Failure
to create a virtual display now has a visible error even if the driver returns
false instead of throwing.

Disconnect stops sharing, releases input and requests removal of the virtual
display. An in-progress creation is cancelled and cleaned up when it settles.
Reconnection requires explicitly starting Extend again. This uses existing
screen protocol messages; no wire changes are required from macOS.

This increment covers one-to-one mode, not the separate multi-device sender in
`windows/mesh/`. Use one-to-one mode for initial paired testing.

## Validation

`node --test windows/test/screen-lifecycle.test.js`: 23 tests pass, including six
new cases for missing/checking drivers, creation timeout, disconnect during and
after creation, and physical input coordinates on a negative-origin monitor.

These use Electron/helper mocks. They do not validate an installed driver,
display topology preservation, mixed-DPI Electron coordinate conversion,
REAPER FX compatibility, hardware encoding, or window recovery on real hardware.
No driver was installed and no desktop topology was changed by this increment.

## Mac integration expectations

- Request Extend explicitly using existing screen.ctl fields; do not silently
  substitute Mirror after failure.
- Keep screen.policy dimensions accurate for the selected receiving display.
- Screen input remains normalized over the whole captured display, without wid.
- Show the existing screen.state off transition after failed startup. Detailed
  driver errors currently appear on Windows; remote error reporting would need
  coordinated work if the existing Mac UI cannot explain this state adequately.
- Test REAPER floating editors through whole-display capture. Do not route them
  through app-window classification merely because they are owned/tool windows.

## Next Windows validation

Build the native helper and desktop app; inspect actual virtual-display driver
status; then test Windows-to-Mac Extend with the three physical monitors intact.
Use the REAPER checks in `docs/network-monitor.md`, including unplug/reconnect
and modal dialog recovery. Validate inverse-direction viewer input with the Mac
branch before claiming the bidirectional workflow is ready.

## Built test app and destination taskbar support

Build with `npm ci` in `windows`, then `node node_modules/electron/install.js`
if the runtime was not downloaded by npm. Run
`node installer/build-network-monitor.js <new output directory>`.
This produces an unpacked Windows x64 test application with native C# helpers,
an isolated settings folder, upstream update checks disabled and audio streaming
off initially. It does not install drivers, create signing certificates or change
the firewall. Optional phone, camera, gamepad and Rust input binaries are omitted;
the existing Node input lane remains available.

The app was launched and its first-run UI verified on Windows. The user installed
the virtual display driver and ran Fix. Read-back confirmed the driver is present
with problem code 22 (disabled while Extend is off), both Extend scheduled tasks
are present, Wi-Fi is Private and the application listens on TCP 47800.
Pairing, active Extend and hardware window movement have not yet been validated.

First paired tests: Scarlett 2i2 (3rd Gen) Device Settings, then File Explorer
from Windows; Finder from Mac. Preserve Scarlett's supplied baseline: 48000 Hz,
64-sample buffer, USB Internal clock and Safe Mode enabled. Do not change driver
settings merely to test remote clicks: open a dropdown and dismiss it unchanged.

### Existing-message identity contract for the Mac agent

Destination-side minimize/restore and original logos are required. Whole-display
Extend by itself does not create separate native taskbar/Dock buttons; test this
requirement through crossed-window proxies separately from monitor extension.

- Windows sender now gives moved windows stable opaque `id` values rather than
  the shared generic `moved` value, retaining `wid` and `moved: true`.
- Windows sends names and PNG data-URL icons in existing `PAPPS_RESULT` entries
  `{id, name, icon}`. Icons can arrive after `PAPP_WINDOWS`; refresh existing Dock
  proxies when the catalog changes. Popups inherit the owner's application id.
- For Mac-to-Windows, send the real bundle id (e.g. `com.apple.finder`) in each
  moved `PAPP_WINDOWS` entry's `id`, and matching `{id, name, icon}` entries in the
  existing `APPS_RESULT` catalog. Windows now consumes that catalog for moved
  Mac windows as well as launched Mac apps. No shared protocol file was changed.
- Windows receiver explicitly enables taskbar/minimize for remote main windows,
  supplies a cached ICO path and per-app AppUserModelID, and refreshes icons if
  the catalog arrives late. Generic legacy `moved` entries get distinct fallback
  identities, but cannot show the original logo without source metadata.
- Minimizing is local to the receiving proxy; restoring focuses the source
  window. It must not send Close or Return. Popups remain owned windows.

59 targeted tests pass (screen lifecycle, monitor renderer/input, app sender and
destination taskbar identity). These include mock-based Finder icon/minimize
tests and Windows sender identity/icon tests. Actual Finder-logo appearance in
the Windows taskbar and Windows-logo appearance in the Mac Dock remain paired
acceptance tests, not verified outcomes.

### Automatic title-bar drag test

Windows supports `pcApps.moveKey: "auto"`: a native move-start event confirms a
title-bar drag, then existing edge crossing transfers the window. Native local
movement remains owned by Windows. Resize borders and client-area drags are
excluded by a bounded non-client hit test outside the low-level mouse hook.
Saved modifier choices are preserved; select Apps > Move gesture > Automatic
(title-bar drag) once on an existing profile. No shared wire format changes.

Keep Share screen Off for the seamless-window test. Test Scarlett first: drag
its title bar across the configured shared edge, open and dismiss a dropdown
without changing audio settings, minimize/restore on Mac, then return it. Test
Explorer next; verify resizing and file dragging do not transfer its window.
Compilation and JS tests do not establish native gesture or paired Mac success.

Mouse edge resistance also enables a 150 ms dwell; setting resistance to None
removes both the outward-distance requirement and dwell on Windows.

Mac handoff: implement normal title-bar dragging independently on the Mac side.
Investigate the extra Mac display in the mouse-layout map: it may be an Extend
or app-parking virtual display. Identify its role before excluding it from the
physical mouse-crossing layout. Windows cannot identify it from the screenshot.

### Build 04: virtual desktop for source windows

`windows/app-desktop.js` owns the backing display while individual windows are
crossed. It starts the existing installed VDD on first transfer without creating
a screen stream. Whole-screen Extend is mutually exclusive. The display keeps
its driver-selected resolution; automatic matching of receiver size is not yet
implemented. The first transfer may wait for driver activation.

`windows/moved-windows.js` replaces legacy park/touch for Windows. Source windows
remain on the display during input. The helper records home coordinates before
relocation, restores on EOF, and clamps returns to surviving physical displays.
Disconnect, policy disable, transfer disable, quit, and stream failure return
windows. Driver removal is detected through display removal events. Hard killing
the helper is not covered by the EOF recovery path; startup VDD cleanup remains.

The backing display is excluded from Windows KVM geometry and the outgoing
physical display map. No shared or Mac files or wire schemas were changed.
Existing per-window streams, popup ownership, app identities and destination
minimize behavior remain. Scarlett and Explorer are the first paired tests;
non-captioned REAPER child/editor windows are not yet validated.

Test: quit Build 03, launch Build 04, keep Share screen Off, drag Scarlett by its
title bar over the shared edge, interact without changing audio settings, then
leave it idle for over 3 seconds. It must never reappear on a physical Windows
display. Test Dock minimize/restore, return drag, and disconnection. Repeat with
Explorer and a dropdown. Native compilation and mock-based JS lifecycle/input
tests pass; end-to-end paired behavior remains unverified until that test.

### Build 05: physical mouse boundary

Build 04 excluded the app display from KVM geometry but did not constrain local
physical mouse motion. Windows could move the pointer onto the backing display,
past the physical edge that triggers crossing. The mouse hook now clamps only
non-injected, uncaptured physical movement to physical screens while an app
display is active. Injected app input still reaches the backing display.
Both helpers compile; six native geometry assertions pass (backing exclusion,
edge detection, overshoot, adjacent physical monitors and ordinary Extend).
The Windows-to-Mac intermittent crossing report still requires live retesting;
input-lane reconnects were also observed and are not proven fixed by this patch.
Mac should check its physical pointer boundary as well as filtering its map.
