# macOS network monitor

The `mac-network-monitor` branch adds one-to-one Extend support on top of TwinDesk's existing whole-display capture. The screen, input, KVM and clipboard messages use the existing protocol.

## Windows to Mac

1. Pair the apps in one-to-one mode. On the Mac, open **Receive screen**, select **Full-screen monitor**, and turn on **Open full screen** and **Control it**. The default follows the Mac's primary display. A saved monitor that is unavailable falls back to the primary display.
2. Choose **Extend** in the Mac's sharing control for the PC, or start **Extend** on Windows. The generic **Open** action can start Mirror. When Windows is configured to match the Mac, it uses the selected display's logical size from the existing screen policy. The Mac viewer preserves the incoming aspect ratio and maps pointer coordinates to the displayed image.
3. Drag a Windows Explorer window from a physical Windows monitor onto the display shown on the Mac. Try scrolling, dragging, typing in the address bar, opening a context menu and copying text in both directions. Test the Scarlett device-settings dialog separately by moving it, opening and dismissing a dropdown, and dragging it back. The Scarlett audio device stays on Windows. Plug-in or audio changes are unnecessary for this test.

## Mac to Windows

1. Select **Extend** under **Share screen** on the Mac and open **Receive Screen** on Windows. The Mac creates an independent virtual display using its configured size. The current Windows viewer sends an accept flag without monitor dimensions, so choose the virtual display size on the Mac.
2. Drag a Finder window from a physical Mac monitor onto the TwinDesk display. Test dragging, keyboard, scrolling, menus and clipboard from Windows. On each source OS, repeat with REAPER's FX chain and an individual floating plug-in editor while the main window remains on the source monitor. Float embedded editors or move their containing window.
3. Stop Extend or disconnect while a test window is on the network display. Verify that the removed display's windows are reachable on the source, reconnect and start Extend explicitly, and check that no keys or mouse buttons are held. The Mac relies on macOS to relocate ordinary windows when the display is removed. Restore enabled app-specific window placement or reopen the editor from its FX chain if the app needs it. If another TwinDesk feature still holds the virtual display, it can stay connected until that feature releases it.

Explicit Mac Extend requires the TwinDesk display. A creation failure takes sharing off and shows the local error. The remote endpoint can see the existing off state; a detailed remote error would require coordination. Screen sound is off by default. The existing screen-sound and separate audio-sharing settings remain opt-in.

## Receiving taskbar and Dock integration

Whole-display Extend presents a single desktop viewer. For individual Finder or
Explorer icons, minimize and restore through the seamless window transfer
workflow below.

## Validation

- `node --test mac/test/*.js` exercises the selected-monitor policy, explicit Extend, missing virtual display, whole-display source selection and late capture cancellation, and input release. These tests use mocks.
- ARM64 `MAC_ADHOC_SIGN=1 npm run dist` builds the app without setting up a signing keychain. `codesign --verify --deep --strict` verifies the resulting bundle.
- The native helper created and removed an independent 1280 × 720 display twice on this Mac. CoreGraphics reported the same bounds and primary status for the existing physical display during and after both cycles.
- REAPER 7.86 was installed. An existing FX chain with installed VST3 effects was visible locally. No REAPER project was changed. Network rendering, input, and recovery for REAPER and the Windows Scarlett dialog require the paired-device tests above. Mixed-DPI fullscreen, clipboard, floating-window recovery and audio behavior also need paired validation.

## Seamless window transfer

Use **Apps → Move windows → Move gesture → Automatic (title-bar drag)** on both
computers. On Windows use Build 04 from `windows-network-monitor` or later. Pair
in one-to-one mode and configure the shared edge under **Mouse**. Keep **Share
screen** off on both machines. Previously saved modifier choices are retained;
select Automatic in existing profiles. Drag the unoccupied part of Finder's
title bar across that edge, then release. Start a new title-bar drag on the
destination to return it over the edge. Closing the destination copy also
returns the source window.

The Mac helper assigns each transferred window its own virtual display and
keeps its source window there during capture, focus and input. The display stays
visible to macOS and WindowServer. TwinDesk filters it out of the Mac’s physical
mouse layout, native KVM geometry and screen picker. Whole-screen Extend and
Mac-source seamless transfer are mutually exclusive. Starting Extend returns
crossed Mac windows before the Extend display is created.

Finder travels as `com.apple.finder` in `PAPP_WINDOWS`. The Mac publishes the
same ID, localized app name and PNG icon through `APPS_RESULT` so Windows can
apply the Finder icon and taskbar identity. Windows-to-Mac proxies use the
existing Dock app and refresh its icon when `PAPPS_RESULT` arrives. Minimize
keeps the proxy and stream available, and selecting the app icon restores the
destination window. The proxy uses native window controls with a streamed
client area. These paths use existing wire messages.

The helper owns original geometry and returns each window on explicit return,
disconnect, policy disable, normal quit, or failed main-window capture. A
request cancelled while its display is being created cannot subsequently move
its source window. On an unexpected hard helper exit, WindowServer removes the
backing displays and is responsible for relocating their remaining windows.
A return uses the original physical region or a surviving display. Attached panels are expected to appear when composited into the captured window.
Separately captured popups must be composited on the same backing display and
identifiable as windows owned by the same process. Arbitrary child surfaces,
custom chrome without usable Accessibility roles, out-of-process popups, and
protected capture surfaces require separate validation. This build limits
Mac-source transfers to four active windows and bounds window dimensions to
the existing encoder limit.

Paired acceptance uses Scarlett Device Settings and Explorer from Windows,
then Finder from Mac. For Scarlett, open and dismiss the dropdown without
changing the sample rate, buffer size, or Safe Mode. For each, verify input,
state after idle, icon-based local minimize/restore, return, and disconnect.
Test REAPER FX editors after ordinary windows pass.


The Windows reference checked for this change is Build 05 at
`5edaf6e`. It includes Build 04’s per-window virtual desktop. Both builds use automatic title-bar crossing, keep backing displays
out of the physical map, constrain local pointer movement to physical
screens at the backing display boundary, and keep remote app input on the
source backing display.
Windows retains one VDD at its driver-selected resolution. The Mac creates
individual backing displays sized for its source windows. No shared protocol
change is required.


Validation for seamless transfer: 10 Mac JavaScript tests and 59 targeted
Windows JavaScript tests passed. A native Mac smoke test created a real
independent 1280 × 900 backing display, verified exclusion from KVM geometry
and clamping onto the physical display, and confirmed removal in the CoreGraphics
online display list. The detached shell helper lacked Accessibility and Screen
Recording permissions, so this native smoke test used a temporary display
without moving an existing app window. Live Finder, Scarlett, Explorer, Dock
and taskbar behavior require the paired tests.


### Build 05 follow-up candidate

The macOS receiver uses a frameless native proxy for crossed Windows windows,
so the captured Windows caption is the only visible title bar. An invisible
drag strip covers the top 30 points except for the rightmost 144 points, which
remain available to the source's controls. Use Command-M to minimize the Mac
proxy locally, and restore it from its app icon in the Dock. The strip assumes
a conventional top caption; custom layouts need validation.

Mac title-bar detection also runs on relative mouse input delivered from
Windows through KVM. When a recognized drag reaches the configured return edge,
the helper releases that native drag and reports the same crossing event as a
drag from the Mac trackpad. This path does not handle per-window injected
events, so remote app input cannot inadvertently transfer the source again.
The candidate is based on Windows Build 05 and uses its existing messages.

## Review of the Windows integration baseline

Reviewed Windows at `ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb`.
That commit documents coordination and includes the Windows Build 05 code.
The Mac implementation under review is
`84135c6aed1ed0d1f378b250b40e41ae23d6837c`. The integration owner should build
both platforms from the same reviewed integration commit. The shared release
identifier, integration SHA and platform source SHAs belong in the candidate
metadata. Build 05 remains the historical Windows test iteration.

### Compatible behavior

- Windows serializes access to one installed VDD at the driver's active mode.
  Mac allocates a separate backing display sized for each source window.
  Neither transfer path starts a desktop video stream. Both address app input
  by `wid` and inject it at the source window on the backing display.
- Both filter the backing display from their advertised layout and native
  crossing geometry. Windows clamps physical hook events while raw motion
  supplies crossing deltas. Mac clamps local motion and leaves injected app
  events alone. Windows Build 05's TCP setting is a diagnostic for reported UDP
  mouse loss. Compare the same crossing and reconnect checks under TCP and UDP
  and record the negotiated lane, rather than treating TCP as a protocol change
  or a confirmed fix.
- Windows sends stable opaque app IDs in existing `PAPP_WINDOWS.id` and
  matching PNG icons in `PAPPS_RESULT`. Mac sends real bundle IDs, including
  `com.apple.finder`, and matching icons in `APPS_RESULT`. Both accept catalog
  updates for existing proxies. Existing `wid`, `moved`, `popup`, `owner`,
  `x`, `y`, and `scale` meanings, window RTC2 signaling, input, and return
  messages are used as before. This Mac branch adds local helper commands for
  parking, return and proxy captions. It adds no peer message types or fields.

### Findings for Windows review

1. **Verify native placement before advertising a transfer.** Windows
   `VirtualPlace` validates the handle and registers its home, then calls
   `Place`, which ignores the result of `SetWindowPos`. The JS sender treats
   the helper reply as success and the list builder emits crossed windows even
   while an out-of-bounds window is being repositioned. A rejected or adjusted
   placement can leave a source visible on a physical monitor while its proxy
   accepts input. Verify the resulting frame is on the backing display before
   publishing the window, and handle failure as a return. Test a window that
   resists movement and one larger than the backing mode.
   [Native placement](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows-helper/src/AppWindows.cs#L443-L450)
   [JS transfer and polling](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows/moved-windows.js#L15-L60)
2. **Agree on release after the last window returns.** On Windows, returning
   the last window or losing its stream does not release the app VDD. Extend
   refuses to start as long as the VDD is flagged for Apps. A user can therefore
   return every window and still have to disable Move windows or disconnect
   before Extend works. Mac removes each backing display on return. If Windows
   intends to keep the monitor warm, document that lifetime and explicitly
   yield it to Extend when no transfer is active or pending. Test return,
   destination close, and failed capture with the last and second-to-last
   windows.
   [Release sites](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows/pcapps.js#L64-L98)
   [Extend ownership guard](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows/pcscreen.js#L111-L121)
3. **Check title-bar parity and local minimize together.** Windows still uses a
   framed main proxy for Finder. Mac uses a frameless proxy for crossed Windows
   windows and Command-M for local minimize. A source caption present in the
   Finder capture can produce two title bars on Windows. Agree which caption
   should be visible and how the receiver handles minimize versus sending a
   source action. Test standard Explorer and Finder chrome as well as Scarlett's
   custom controls. Coordinate before adding any caption metadata.
   [Windows main proxy](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows/peerapps.js#L251-L284)
4. **Exercise recovery beyond a normal disconnect.** Windows records home
   positions in the helper, returns them on pipe EOF, and tries to release the
   display on policy change, quit and topology removal. A forced helper kill
   cannot run the EOF handler. On Mac a hard helper exit relies on WindowServer
   rehoming windows as their displays disappear. On both platforms verify
   normal disconnect, policy disable, display loss, quit and helper failure with
   a window and a popup open. Also return one of two crossed windows while a
   modifier or drag is held, then verify the surviving proxy has no held input.
   [Windows helper EOF](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows-helper/src/Program.cs#L156-L166)
   [Windows input routing](https://github.com/travisisgood/TwinDesk/blob/ef1d760d0d49abbc02520ac7d2bff50de8c8ccbb/windows/pcapps.js#L399-L443)

### Review validation

Re-ran 10 Mac tests and 68 targeted Node tests from an isolated export of
Windows `ef1d760` on Mac. All 78 passed. The Windows suite used mocks for
Windows-specific components. The Mac candidate at `84135c6` was built and
signature-verified before this documentation review. These runs do not exercise
the native Windows VDD and hooks or establish a paired candidate.

Outstanding live checks include Finder from both the Mac trackpad and Windows
mouse through KVM, original Dock/taskbar icons, local minimize and restore,
Scarlett dropdowns without changing audio settings, Explorer and REAPER FX
popups, TCP versus UDP crossing, and disconnect/reconnect and emergency
recovery. Use a reviewed integration commit and shared identifier for the
paired candidates.

## Signing Mac test builds

Use the same Developer ID Application identity, bundle ID and app path across
updates on the test Mac. Select the existing identity with
`MAC_IDENTITY=<identity> npm run dist`, without `MAC_ADHOC_SIGN=1`. Check the
bundle with `codesign --verify --deep --strict` and compare
`codesign -d -r- <app>` across builds. Moving from ad-hoc to Developer ID
signing requires granting permissions for the new identity once. Future builds
with the same designated requirement should retain them. Verify each of
Screen Recording, Accessibility and Input Monitoring on the test Mac before
treating permission retention as confirmed.
