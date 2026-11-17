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

## Receiver parity implementation checkpoint
Windows receiver now accepts the mutually agreed capability-gated resize operation:
`resize` with `{logicalSize:{width,height},pixelScale}` (Mac points/Windows96DIP,
scale1..3 subject existing raster limits). It coalesces requested sizes, allows one
resize in flight, blocks remote interaction until both successful result and new
revision display, and reconciles to actual source logical dimensions. Rejections
preserve the old geometry. Uses content size rather than outer-frame size.

Optional `sourceDragRegions` capability and `dragRegions` logical rectangles are
validated for bounds/overlap. Supplied regions map using the same contentRect
transform as clicks; source controls must be excluded by the source. Older peers
retain the temporary grip. The receiver crops capture padding and handles
letterboxing consistently.18 receiver/protocol/geometry/transport/TLS tests pass.
These changes are not yet paired-validated with Mac's new source; full pointer/
keyboard and automatic boundary crossing remain missing and mandatory.

Historical resize investigation: mac/pcapps.js sends PAPP_SIZE after receiver
resize; windows/pcapps.js dispatches winSize; windows-helper/src/AppWindows.cs
Resize uses SetWindowPos with NOMOVE/NOZORDER/NOACTIVATE and restores invisible
frame-border allowance. This is an actual source resize request, not bitmap-only
scaling. It does not read back success/actual dimensions. We require source readback,
containment and recapture in the new path, including fixed-size rejection/clamping.

Travis reiterated monitor-edge drag currently stops in place. Final acceptance
requires continuous drag across the edge and natural local placement, in both
directions, with source-appropriate dragging/input/size, taskbar/Dock identity,
and uninterrupted KVM. Manual pairing remains diagnostic only.

## Paired Finder resize result — 2026-11-16 Toronto
Mac source f57954db61b76bed2fcd1198205d5ddb80c87387 / Windows receiver
4ccd1470d4827d98b685e613bc47dfeed957e1c0, real FinderNetwork-ab259db1.
- Initial revision1: logical800x550, raster1600x1100, receiver scale1.5.
- Windows native Size menu grow: revision2 logical813x550, raster1220x825,
  resize inputseq2 dispatched; new frames continued. Toolbar reflow observed.
- Actual Name header click after resize: inputseq3 dispatched; sort arrow changed.
- Native Size menu shrink: revision3 logical800x550, raster1200x825,
  resize inputseq4 dispatched; new frames continued (seq780 observed).
No resize echo was observed between operations. Mac's source readback confirmation
requested separately; source metadata is the reported applied geometry evidence.
The receiver is left visible for Travis; no forced disconnect recovery test yet.

Boundary/corner drag automation initially hit source content and returned unsupported;
Windows Size menu was used to exercise real native receiver resizing. These results
are not proof of source-native titlebar dragging, general input, automatic edge
transfer, or human approval of sharpness. Mac does not yet advertise sourceDragRegions.

## Gated normal-input receiver checkpoint
Windows accepts separate optional pointer/wheel/key/text capabilities. Pointer uses
normalized coordinates and DOM button0left/1middle/2right. Wheel is logical units
(positive down/right), deltas bounded4096. Key uses keyboard-page HID usage4..231.
Text is committed UTF8 bounded4096bytes; printable characters are not duplicated
as HID events. Renderer routes pointer capture, coalesced movement, wheel, basic
keyboard/committed-text events only for advertised capabilities. IME/native text
entry and full keyboard-layout behavior are not yet validated.

Stateful pointer/key requires releaseAll capability. releaseAll args{} uses existing
input sequence/window/session but bypasses geometry/display/resize and ordinary
queue saturation; only one outstanding release. Receiver sends on blur/close and
before resize, source independently must release owned state on failure/timeout
and geometry change. Invalid or overloaded pointer/key dispatch requests release.
21 receiver/transport/TLS/geometry tests pass. Native Mac target input remains
UNPROVEN; no new capabilities are advertised by Windows on Mac's behalf. No
paired normal-input or edge-handoff acceptance is claimed.

## Human-confirmed Finder title dragging — 2026-11-16 Toronto
Source8e62c220d1086f828c6856fb30afd65ef011f439 / receiver049dd7f, real
FinderNetwork-5f1866dc. Source supplies actual AX toolbar drag regions excluding
controls; receiver preserves native drag DOM across video frames. Automated drag
reported unchanged origin and was inconclusive. Travis was asked to drag the actual
title text and explicitly replied: "Yes, it moves". Native title-area local dragging
on Windows is USER-CONFIRMED PASS. Do not discard this evidence after compaction.
This does not prove toolbar controls, general interaction, or automatic monitor-edge
transfer. No source-region redesign is justified by the failed automation alone.

## Automatic edge handoff groundwork
Windows inspected existing KVM/native edge dispatch: `moving` HWND/fromX/fromY
currently routes only to legacy PeerApps/PcApps. Standalone receivers are not
registered there, and native AddMoving cancels the source move loop without
forwarding the original grab anchor. Do not enable legacy transfer for the new
receiver as a shortcut.

New receiver handoff-state.cjs is an ISOLATED primitive, not installed in KVM and
not a wire protocol. Placement preserves normalized grab point at a selected
physical display edge using logical units, allowing natural partial offscreen
placement. Preparation binds session/window/revision and authorized display;
commit requires first frame displayed, button still held, unchanged layout and
geometry, and a5sec maximum offer lifetime. Abort yields prior receiver bounds;
duplicate commits/offers are rejected within bounded recent history. Five tests
pass including negative-origin monitors, stale revision, topology change, release,
deadline rollback and duplicate commit. Integration requires agreed source offer/
ready/commit plus authenticated non-AI broker and continuous pointer ownership.
This is NOT automatic edge transfer acceptance and does not fix source input.

## Handoff review amendment
Mac review70 accepted: offers need both layout revisions, session-monotonic sequence,
local monotonic ttlMs<=5000 (not peer wall time), explicit drag ID/held state and
pointer ownership epoch. Isolated Windows primitive now checks local TTL, both
layout revisions, session sequence beyond bounded ID history, and ownership guards.
Seven tests pass. It remains NOT wired to broker/KVM. Ready's decoded frameSeq,
idempotent committed ACK with epoch advancement, drag identity and source-owned
recovery remain broker integration requirements, not implemented by this primitive.
Lost commit ACK must fail closed/release/recover, never infer two owners. Reverse
crossing starts a fresh offer/drag for the same source window. Normal Finder input
still unproven; Mac probes have not changed state and no general caps are enabled.

## Native Finder pointer readiness
Mac03285ac reports ordinary CGEvent Alpha selection, replacement by Beta, and
doubleclick opening PortalChild with source bounds/cursor unchanged and previous
app restored. This is source-local proof, NOT paired receiver acceptance yet.
Mac must integrate focus lease, owned button release, stale-geometry handling,
disconnect/helper-exit recovery before advertising pointer/releaseAll.
Windows renderer regression now confirms down/up are not duplicated as pressAt,
no modifier is fabricated, queued old movement is discarded around button events,
and outside release/cancel sends releaseAll.16 focused protocol/renderer tests pass.
Doubleclick contract currently has no clickCount field: source derives click count
from same-button timing and target point unless both peers agree an extension.
Wheel/key/text and natural monitor-edge handoff remain unverified/unfinished.

## Active shared priority — Mac windows on Windows
Travis explicitly narrowed both agents to ONE direction on2026-11-16:
Mac windows must work on Windows with end-to-end macOS behavior parity.
Mac owns source capture/native input; Windows owns receiver presentation/input
delivery/taskbar integration. Defer Windows-to-Mac feature work. Finder is the
acceptance target; extend to other Mac applications after Finder behaves properly.

Next paired candidate priorities:
- Responsiveness: remove receiver per-input screenshots (1209 files/303MB in
  initial live run), bound hover backlog, reduce repeated native focus waits,
  compare lower capture density with measured input and frame timing.
- Correct sharp rendering, click coordinates, scrolling, keyboard/shortcuts/text.
- Working toolbar controls, context menus/popovers, source-positioned traffic
  lights, actual source resizing; local taskbar minimize/restore retains source.
- Natural Mac-to-Windows edge transfer, continuous drag, stable backing display,
  recovery on disconnect. Isolated handoff tests do not establish live acceptance.

Receiverc893ed0 has optional receiverWindowControls metadata support; Mac source
must send genuine control rectangles before controls appear. Existing red action
returns source home; this prototype behavior is not yet full native close parity.
No live speed improvement, scroll or window-control acceptance claimed until
the fresh source and receiver are paired and observed together.

## Paired Finder ordinary pointer acceptance — 2026-11-16
Receiver36e90f9a5de537afca7848cc8fb119d5c9f4e565 with Mac source
7cf62c44b7e6829d1b96f91a9deca2cbd5aca1dd visibly passed ordinary Alpha.txt
selection, replacement selection of Beta.txt, and double-click PortalChild opening
the actual folder with Inside.txt. No command modifier or semantic selection was
substituted. Receiver left visibly running for Travis. Toolbar Back reported
dispatched but did not visibly navigate in the delayed observation; not accepted.
Wheel/key/text remain unavailable. Source session expiry02:07Z Nov17 was reported
to Mac with request to preserve test availability. This supersedes earlier
statements that normal Finder input is unproven, but is NOT edge crossing proof.

Windows added an isolated PORTAL_HANDOFF1 adapter around handoff-state: requires
registered session/window and decoded frame sequence, echoes drag identity in
ready/commit, advances ownership once and acknowledges retries without duplicate
placement. Local deadline/disconnect releases pending ownership. It is not yet
connected to messenger or native KVM; native placement/ownership callback and
Mac adoption remain required before any automatic edge acceptance.

## Paired speed/wheel candidate — 2026-11-16
Live receiver bf5bfadbfc6d3f4fcabdf1ee23102158e6bf7d46 with source
0463c0930a02466de6135148b7f606c79a7ceae9, FinderNetwork-701cb1e7:
- Actual Applications navigation and scrolling visually verified. Wheel ACK14ms.
- Yellow control minimized receiver; restoring retained Applications scroll state
  and source stream. Trafficlights visibly rendered from source AX rectangles.
- Pointer ACK first119/101ms, later41/23ms. These are dispatch round trips, not
  end-to-end visual latency. Stream remains about5fps at800x550/1x.
- Ellipsis click dispatched but no popup visible. Mac investigating.
- Green maximized receiver but source stayed800x550/rev2: stretched image,
  NOT resize acceptance. Restored normal size. c0edef9 adds explicit maximize
  scheduling, selected capture-density preservation and resize diagnostics;
  not loaded into this live receiver, needs next paired validation.
- Keyboard/text remain disabled. No natural edge handoff acceptance.
Source deadline02:42:45Z Nov17. Receiver left open; CUA capture helper released.

## Keyboard focus paired retest — 2026-11-16
Receiver6db6bb6ec9067cfe353ddf0465fbcf47b345f49d paired with unchanged Mac
sourceaaf69d62364be7592c454368d238b672db92cdf8, adopted same ApplicationsFinder.
DPI resize echo fix passes: geometry stayedrevision1/800x550 atWindows125%scale,
without unsolicited551/552height requests. Searchfield bluefocus visible.
CUA type_text and physical-key helper invocation produced no receiver key/text
input logs. Keyboard acceptance remains unresolved; asked Travis to try actual
physicaltyping to distinguish test-input method from receiver focus/routing.
No sourcekeyboard failure inferred from absent receiver messages. Capture helper
released and currentwindow leftopen for manualtest. Previousaafcandidate visually
showedActionmenu andoutsideclickdismissal; menu clipsoutsideparentcanvas.
Changingcaret frames~13fps, not full-motion acceptance. Greenresize stillpending.

Bootstrap groundworkb1ce03d/6db6bb6: session-bootstrap gate and fixedlocal encrypted
launcher, hiddenreceiver decoded-frame IPC and5secabortdeadline. Fivegate andtwo
crypto/configuration tests pass. No liveauthenticated messengerpump/nativehelddrag
ownership bridge yet; no reveal/commitIPC implemented. Never enableedgebroker on
unit-test evidence alone. Nativehand-off remains deferred untilpairedinputtests.

## Text-event correlation correction
Mac reported textseq6 dispatched in the current paired session. Windows confirms
textseq6 dispatched at02:51:05.629Z, roundTrip34ms; Mac timestamp02:51:07.346Z
shows wall-clock offset, not extra network latency. The earlier zero-input
statement was based on a premature log tail and is superseded. Text transport and
source dispatch are proven. Attribution to automated versus physical typing and
visible field contents are not established; no typed content was inspected or
shared. Await Travis's physical-keyboard result before claiming full keyboard
acceptance. Edge broker remains disabled; native ownership bridge outstanding.

## Windows-owned native continuation groundwork
NativeDrag.cs/build-native-drag.ps1 compiles a separate console helper. A read-only
--probe ran successfully on Windows. --follow binds the receiver HWND/PID/process
start time, requires a hidden receiver, samples the physical left-button high bit,
and accepts only lease/commit/cancel on its local pipe. Commit checks the button,
places and shows the receiver without activation or synthesized input, and checks
actual visible bounds. Subsequent movement preserves normalized grab anchor using
physical cursor and native window coordinates. Release leaves it at the drop
point; cancellation, identity loss, topology change, broker EOF or lease expiry
hides it. Lifetime is capped at60seconds; a local broker lease expires after1.5s.

native-drag.cjs validates fresh samples (150ms), requires an independent local
KVM ownership callback, waits for native committed ACK and cancels if ownership
is lost. Three focused wrapper tests pass. This is HWND placement continuation,
not Windows' built-in caption move loop/snap behavior. It currently handles only
Windows-owned physical dragging; Mac-owned injected continuation is unsupported.

NOT live-integrated: the authenticated broker still needs the actual local KVM
route/ownership feed and pointer-return fence before it can supply that callback,
then wire hidden receiver reveal and await the native ACK before committed wire
response. Never derive ownershipValid from peer text or a constant true callback.
No current Finder window was moved or hidden during helper development.

Native API references: [GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate)
and [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos).
