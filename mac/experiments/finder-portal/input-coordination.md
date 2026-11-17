# Agreed staged input contract — not yet advertised

Windows accepted the following proposal in `WINDOWS_INPUT_CONTRACT_ACCEPT_75`.
These are optional standalone capabilities/operations, not changes to the main
TwinDesk protocol. Finder currently advertises only the tested semantic controls,
resize and sourceDragRegions. Do not imply general pointer/keyboard support.

- `pointer`: `{phase:"move"|"down"|"up",button:0|1|2,x,y}`. Coordinates normalized
  to displayed content; DOM button numbering left/middle/right. Move uses button 0
  and tracks held state without synthesizing an implicit down.
- `wheel`: `{x,y,deltaX,deltaY}`. Finite logical-unit deltas within ±4096, positive
  down/right, applied only to the selected backing window.
- `key`: `{phase:"down"|"up",usage}`. USB HID keyboard-page usage integer 4..231.
- `text`: `{text}` committed UTF-8, at most 4096 bytes; do not also inject a
  printable key event for that same text.
- `releaseAll`: `{}`. Required alongside stateful pointer/key. Retains monotonic
  sequence and session/window identity checks, but is exempt from displayed-frame,
  geometry/resize gates and ordinary queue saturation because it only releases
  state already owned by the source. Idempotent; never creates new held input.

Receiver releases on blur/disconnect best-effort and before resize. Source releases
independently on timeout, close, failure and before geometry changes. Bound held
state. Never restore to a physical display, inject globally as a fallback, or
advertise a native route before actual backing-window interaction tests pass.

Earlier process-targeted CGEvent testing with explicit window fields did not
establish working input. Next native probes must independently show changed
Finder state, unchanged physical cursor, unchanged backing position, and release
after failure. Semantic selection/open-folder/scroll-page may be staged separately
but must be labeled as a subset; they cannot substitute for native-equivalent
interaction acceptance. Existing minimized-source AXOpen restores the source and
remains disabled. No new native input route is implemented by this document.
