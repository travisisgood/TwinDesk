# Bidirectional network monitor

## Intended experience

Use the Mac as an additional Windows monitor (fourth in Travis's setup), and allow
the inverse: a Windows display acts as an additional macOS monitor. Preserve the
existing physical display arrangement. Share keyboard, mouse and clipboard.

REAPER is a required acceptance case: its main window can remain on the source
computer while floating FX chains and individual plug-in editors occupy the
network monitor. Test owned/tool windows as well as ordinary application windows.

## Architecture decision

Start from TwinDesk's existing **Extend** path. Create an OS-visible virtual
display on the source, capture that display, and present it on the receiving
computer. The application and audio processing remain on the source machine.
This captures the composed display rather than selecting top-level app windows.

Relevant implementation:

- `windows/pcscreen.js`: Extend lifecycle, virtual monitor selection, capture and
  input coordinates mapped into that monitor's bounds.
- `windows/vdd.js`: Windows virtual display driver management.
- `mac/displays.js`: macOS virtual display creation and selection.
- `mac/ui-display-pc.js`: receiving a Windows display on the Mac.
- `windows/screen.js`: receiving a Mac display on Windows.

Do not base the primary experience on the per-window Move windows path. Its
window classification and offscreen parking introduce unnecessary restrictions
for floating FX editors. Keep that upstream feature available separately.

A floating FX editor should behave like it does on a physical extra monitor.
An embedded editor must first be floated/undocked, or its containing window must
be moved. Independent relocation of an arbitrary embedded UI control is outside
the initial scope. These are design expectations, not hardware-tested claims.

## Acceptance checks on real hardware

1. Windows with three existing displays gains an extended display streamed to
   the Mac. Existing display positions and primary display remain intact.
2. Move an existing REAPER FX-chain window and a floating individual FX editor
   onto that display and back with ordinary window dragging.
3. Edit knobs by dragging, use mouse wheel and keyboard entry, open context menus,
   presets, file selectors and modal dialogs. Check focus, always-on-top behavior,
   scaling, negative display coordinates, and mixed DPI.
4. Repeat with stock effects and the user's actual third-party plug-ins. Record
   REAPER version, plug-in format, architecture and any bridged-process behavior.
5. Repeat in the inverse direction with REAPER running on macOS.
6. Verify shared keyboard/mouse and text/image clipboard without duplicate input
   or cursor handoff loops. Check physical source input and viewer-side input.
7. Disconnect, quit and reconnect. Ensure FX windows remain recoverable and no
   stuck keys or inaccessible dialogs remain after removal of the virtual display.
8. Measure interaction latency and REAPER audio glitches under load. Audio stays
   on the source interface by default; audio streaming is not required for this use.

## Status

Fork created and upstream Extend implementation inspected. No behavior changes,
driver installation, paired-device testing or REAPER compatibility validation
have been performed yet. Windows virtual display driver availability and macOS
capture/input permissions must be checked on the actual machines.
