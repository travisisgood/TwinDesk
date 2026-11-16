# Paired Explorer capture, November 15, 2026

Windows source: `8adb557d25121d20dbe373be9ee7938688afea7d`.
Mac receiver: `0ec379513fc8bca5a39b98000fe4014f1cc44c20`.
Standalone wire v1 over pinned TLS; no TwinDesk rebuild or shared protocol change.
Pairing was exchanged as an authenticated encrypted envelope; private credentials
and captured PNGs remain outside the repository.

The actual Windows Explorer window was selected on Windows and captured while on
its backing display. Mac inspected the first native-acknowledged image: the
dedicated Explorer folder showed `BASELINE.txt` and no proof marker. Only after
that inspection did Mac request a file creation. Windows reported creating
`NETWORKPAIREDPROOF.txt` at `2026-11-16T03:08:40.2088301Z`. The final acknowledged
image visibly contained both files. This establishes paired changing Explorer
content, not just repeated delivery of a static image.

Mac recorded 732 native-decoded frames, two distinct PNG hashes, app ID
`win32.explorer`, and no artifact errors. The receiver was stopped normally with
SIGTERM, which sends the protocol close message and ends the native receiver.
The sanitized result and image hashes are in `paired-explorer-results.json`.
Local images are in `outputs/windows-explorer-paired-3/first.png` and `final.png`
beside the repository, not committed test fixtures.

Windows reported source bounds (3864,-876), 767×556, wholly inside DISPLAY35 at
(3840,-900), 1440×900. These coordinates are Windows measurements; Mac did not
independently enumerate Windows displays. Windows subsequently corrected the
settled post-DPI source bounds to (3871,-876), 611×442; the earlier placement
record preceded DPI settlement. This test does not establish input coordinates.

Windows' `WINDOWS_PAIRED_RECOVERY_PASS_48` independently confirmed before/after
DWM bounds exactly (93,76), 767×556, `returned:true`, after receiver close at
`2026-11-16T03:09:24.491Z`. The same DISPLAY35 persisted at (3840,-900), 1440×900,
with physical displays unchanged. Normal source recovery therefore passes by
paired evidence; Mac's native receiver close and Windows' recovery measurement
are separate observations. Windows' subsequent `1d5e0fa` stabilization change
was a local test and is not retroactively attributed to this paired run.

The Mac desktop was locked. Inspection used the received remote Explorer PNGs,
not a bypass of the Mac lock screen. Native Dock icon appearance, visible desktop
composition, local drag/minimize/restore, and Explorer input remain unverified
in this paired run. No input capabilities were advertised or dispatched.

Earlier attempts: source `48f5a834` closed after authentication before metadata
(zero frames); source `b8884df` delivered 971 frames with one distinct PNG but
could not be visually inspected on the locked Mac and had no marker change.
Neither earlier run is counted as changing-content acceptance.

The shared acceptance gates in Windows' `docs/window-transfer-shared-state.md`
at `8adb557` were reviewed. General input, automatic edge crossing/return,
unlocked Dock/taskbar logo checks, and user KVM regression checks remain open.
No Scarlett or REAPER settings were touched.
