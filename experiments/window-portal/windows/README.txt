WindowPortal: standalone Windows window-only experiment

Run Launch.cmd. It reuses the installed Electron runtime, but loads none of
TwinDesk's application code, input services, networking or display drivers.

The demo opens a separate-process disposable source with a live counter.
1. Open live copy (the demo does this automatically).
2. Leave Application-rendered preview enabled.
3. Click Move original offscreen. No display is added or removed.
4. Enable Experimental input and click the test button in the copy.
5. Restore original or close the experiment to restore the source.
Choose an existing application from the dropdown to investigate compatibility.
Do not infer full app support from one successful control.

Measured on this machine:
- Cross-process DWM cloak: denied, HRESULT 0x80070005.
- Chromium capture and direct native Windows Graphics Capture: froze when
  the disposable source was entirely offscreen; resumed on restoration.
- PrintWindow application-rendered snapshots: changing images while offscreen.
- Standard button invoke: accepted by the separate-process source while offscreen.
- Raw mouse-message button click: did not trigger the button in the initial test.
- Audio settings: no input was sent to the Scarlett controls.
- Exact Scarlett Device Settings window was not open for the attempted test.

Limits: local proof only; no networking, edge dragging, popup composition,
general keyboard shortcuts, GPU/plugin compatibility or app-group taskbar/Dock
integration. The viewer is a normal minimizable Windows window with source icon.
PrintWindow may be blank for unsupported apps and is not a high-frame-rate path.
Each snapshot runs in a separate process with a one-second timeout.
The restoration watchdog runs separately and restores position when the helper
exits. Do not terminate the watchdog separately while a source is offscreen.

Source: Native.cs (selection, control messages, restoration, PrintWindow);
WgcProbe.cpp (independent native WGC measurements); main.cjs/preload.cjs/
renderer.js/index.html (local viewer). results.jsonl contains measured runs.
Launch.cmd currently references this machine's existing Electron installation.

Real Explorer follow-up: captured a dedicated folder before/after creating a file while its window was offscreen. The capture stayed unchanged and still showed an empty folder. This fails the real-app live-update test; do not generalize the disposable WinForms result to Explorer. The source was restored after the test.
