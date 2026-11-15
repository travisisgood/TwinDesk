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

Requested behavior: minimize Finder on the Windows network display to the **Windows taskbar** with the Finder icon, then click that icon to restore the same Finder window. The inverse is Explorer minimizing to the **Mac Dock** with its Explorer icon.

Whole-display video has no individual window identity or minimize events. The source OS currently owns minimize and restore. TwinDesk can minimize the viewer as a single app. Implementing the requested behavior requires agreement across both platform branches on how to advertise per-window identity, title and app icon, detect source minimize or close, and acknowledge a receiver's restore request. Source-side window IDs should be scoped to the peer and display session, with proxy entries removed when windows close or the connection ends. The Windows implementation would own native taskbar entries, and macOS would own Dock entries. Inspect TwinDesk's existing Apps mode and its Dock/taskbar integration for reusable mechanisms. Keep the video path whole-display so owned dialogs and floating FX continue to be captured without app-window classification.

## Validation

- `node --test mac/test/*.js` exercises the selected-monitor policy, explicit Extend, missing virtual display, whole-display source selection and late capture cancellation, and input release. These tests use mocks.
- ARM64 `MAC_ADHOC_SIGN=1 npm run dist` builds the app without setting up a signing keychain. `codesign --verify --deep --strict` verifies the resulting bundle.
- The native helper created and removed an independent 1280 × 720 display twice on this Mac. CoreGraphics reported the same bounds and primary status for the existing physical display during and after both cycles.
- REAPER 7.86 was installed. An existing FX chain with installed VST3 effects was visible locally. No REAPER project was changed. Network rendering, input, and recovery for REAPER and the Windows Scarlett dialog require the paired-device tests above. Mixed-DPI fullscreen, clipboard, floating-window recovery and audio behavior also need paired validation.
