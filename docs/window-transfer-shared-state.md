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

## Paired Explorer live-content acceptance (subsequent update)
Source8adb557d25121d20dbe373be9ee7938688afea7d / Mac receiver0ec379513fc8bca5a39b98000fe4014f1cc44c20. Mac independently inspected first.png showing BASELINE.txt only and final.png showing NETWORKPAIREDPROOF.txt as well. Mac reports732 native-decoded frames,2 distinct PNGs,no evidence error. Marker created2026-11-16T03:08:40.2088301Z. Receiver closed2026-11-16T03:09:24.491Z. Windows before/after DWM bounds exactly93,76,767x556, returned:true. DISPLAY35 persisted at3840,-900,1440x900. Changing-content and normal return PASS. Locked Mac desktop means native visible presentation, Dock/icon, and interaction remain unverified.

Startup geometry follow-up1d5e0fa: local Explorer worker now waits for post-DPI stabilization. Placement is3871,-876,611x442; metadata logicalSize611x442, captured pixelSize610x442 (capture pixels and logical dimensions need not be identical). Prior immediate placement metadata used pre-DPI767x556 and is superseded for future sessions. Local worker completed and restored source. This follow-up has not yet been paired on Mac.

## Explorer input local proof (2026-11-16 Toronto)
Added optional scoped UIAutomation helper for supported Explorer column headers (including Windows11 Name split-button). Worker pressAt invoked Name while window lived on backing; independent Shell SortColumns toggled ascending to descending; inspected captured before/after PNGs show BASELINE.txt and ZZZ-sort-proof.txt reversed. No global mouse injection. Three adapter checks passed for invalid coordinates, HWND scope/deadline, and helper failure containment. General pointer/keyboard input remains absent. Local restore100,100 matched position; size rounded918x664 to917x663 across DPI. This input build awaits paired Mac acceptance; previous732-frame marker test did NOT exercise input.

## Unified user feedback and acceptance contract — 2026-11-16
Travis supplied Finder-on-Windows and taskbar screenshots. Finder source icon on Windows taskbar is now USER-VISUALLY-CONFIRMED. This does not establish minimize/restore continuity. Mac previously reported user confirmation of Explorer's Dock icon; keep that attribution separate.

The current result remains a viewer, not the intended seamless remote window:
- User reports mismatched/zoomed DPI and fuzzy content, and source content not fitting its container.
- Normal interaction is absent; current semantic Name/search tests are not general mouse/keyboard acceptance.
- Dragging must work from the source application's native titlebar/toolbar drag areas, excluding buttons and other controls. The Windows receiver's current8px overlay is temporary and does not meet this gate.
- Resizing must resize the actual source window and recapture its reflowed content. Current object-fit:contain simply scales the image inside the resized viewport and does not meet this gate.
- User explicitly renewed investigation of earlier Focusrite-on-Mac resizing, including an otherwise fixed-size Windows source. Determine actual source bounds change versus merely scaled imagery. Respect/read back constraints and rejected resize; do not claim stretched content is real native layout.

Shared implementation requirements before parity acceptance:
1. Define logical source units independently from capture raster pixels and receiver display scale. Windows physical DWM bounds require source DPI conversion; Mac Retina scale alone is not a conversion rule. Provide enough raster density for the destination and avoid accidental upscaling.
2. Source-owned draggable regions and interactive exclusions should be described in source logical coordinates and transformed with the same displayed-frame geometry as input.
3. Agree a bounded resize request/result contract. Receiver requests source logical dimensions; source applies platform-native resize, reads back actual constrained bounds, emits a new geometry revision and matching frames. Reject stale-coordinate input until a matching frame is displayed; avoid resize feedback loops.
4. Expand pointer/keyboard support explicitly, preserving focus and KVM crossing. Report unsupported controls honestly; do not imply general interaction from a header-only capability.
5. Keep originating icon, native receiving taskbar/Dock behavior, persistent backing, and disconnect restoration. Windows owns Finder receiver; Mac owns Explorer receiver. Both implement and review their own source-side support.

Request UNIFIED_USER_WINDOW_BEHAVIOR_66 sent to Mac with all additions. No protocol change agreed or deployed yet. Existing Explorer and Finder sessions must not be restarted simply to record these requirements.
