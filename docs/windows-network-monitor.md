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
