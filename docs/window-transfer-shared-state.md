# Shared window-transfer target and evidence

Owner: Travis. Windows and Mac sessions share this contract; reread after context compaction before changing architecture.

## Target
The real source window lives on a persistent backing virtual display aligned with the peer. The receiving OS renders each remote window in a borderless native receiver over its own desktop. No extra receiver title bar. Native receiving taskbar/Dock minimize and restore retain the source icon. Automatic edge dragging in both directions and working input must coexist with mouse crossing. Never cycle the backing display per transfer. Receiver implementation still exists internally.

Windows tests use dedicated Explorer windows only, per Travis. Mac uses Finder. No Scarlett/audio settings changes or synthetic application test windows.

## Established baseline
Travis previously observed Focusrite on Mac within an unwanted visible container. That established remote presentation, not seamless integration. The new isolated prototype is replacing transfer internals to stabilize lifetime, capture, recovery, and borderless presentation; it is not a new product goal.

## Current evidence (2026-11-15 Toronto)
- Mac Finder to Windows: real received window and fresh marker observed; sort/search actions demonstrated. Receiver closed and Mac independently confirmed source restoration. Full general input, automatic drag, and visual taskbar-icon acceptance remain open.
- Windows Explorer to Mac: source b8884df, receiver2364c7d; Mac reports971 native-decoded frames, one distinct PNG. Static baseline only; changing-content and visible Mac desktop/Dock success are NOT established. Mac desktop locked during testing.
- Explorer return initially drifted7px horizontally and3px vertically across mixed DPI. Native guardian now enables per-monitor DPI awareness. Restore reapplies saved position after the DPI transition. Local normal-close and forced-helper-kill tests both returned exact original DWM bounds93,76,767x556 after parking on backing.
- Backing DISPLAY35 persisted. Current physical map has two MSI displays; earlier OLED disappeared before this source session. Do not infer transfer caused physical topology changes. Live user mouse-crossing regression check remains pending.

## Next acceptance gates
1. Fresh Explorer baseline and new file marker decoded on Mac, independently compared.
2. Exact Explorer restoration and backing persistence after receiver close and failure.
3. Unlocked-desktop validation of borderless appearance, source icon, minimize/restore.
4. Scoped interactive input, then automatic edge crossing both ways without disrupting KVM.

Exchange exact commits and evidence through the authenticated coordination relay. Status/ACK never wakes the peer; requests only when action is required. No recurring AI polling. Keep credentials private. Preserve local work and do not mark an unverified gate complete.
