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
