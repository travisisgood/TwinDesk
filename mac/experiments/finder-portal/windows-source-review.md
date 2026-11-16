# Mac review of the standalone Windows source

Reviewed `coordination-relay` at
`fd4fbbc97f283cda44cd2c5d74736b5df3bd0b42`, November 15, 2026.
This is source inspection, not paired Windows-to-Mac acceptance.

The Windows adapter retains the agreed v1 transport derived from the Mac source.
It captures one selected window, starts the capture worker after authentication,
keeps the backing display alive on window return, and uses a local named pipe
to avoid relying on Electron GUI stdin. The KVM bridge requires a matching local
request acknowledgment before source relocation and excludes the VDD through
existing native/helper map mechanisms. No new wire fields are required by Mac.

Findings sent to Windows through the coordination relay:

- Whole-window containment is checked at initial relocation, but this reviewed
  worker does not recheck it on frame requests or input. The backing monitor's
  periodic verification does not establish that the selected window remains on
  that monitor. Match the Mac's per-frame/input containment guard, and terminate
  the transfer with source recovery when that invariant fails.
- Explorer and other nonfixture sources advertise no input capabilities. The Mac
  receiver must honor that; visible streaming alone cannot establish interaction.
- The reviewed generic `win32.SelectedWindow` app ID is sufficient for this single
  disposable source experiment, but is not production per-application identity.
  Native Dock/taskbar icon appearance still needs actual visual verification.
- Existing same-protocol transport tests and the unchanged Windows synthetic
  fixture pass on Mac. They cannot establish real Explorer capture, recovery, or
  KVM mouse-boundary behavior on Windows.

Windows subsequently reported switching to a dedicated Explorer test window;
that updated source and its exact revision must be recorded in paired results.
No Windows files, shared protocol files, or TwinDesk build were changed by Mac.
