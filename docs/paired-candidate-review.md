# seamless-0.1.0-rc.1 review

Windows reviewed Mac `aaee013` (implementation `84135c6`) against Windows
`ef1d760`. Mac's reciprocal review is in `docs/mac-network-monitor.md`.
Windows follow-up `bcd713f` resolves placement verification and idle VDD lifetime:
native placement checks the entire resulting frame before success; rejected or
oversized placements return without publication. Polling withdraws escaped
sources. The display releases after the last active AND pending transfer ends.
Returning a window also releases held remote input.

Reviewed Mac source parking/unparking, asynchronous cancellation, identity
catalogs, input and resize routing, physical-screen filtering, forwarded
title drags, proxy lifecycle, and transfer timeout/recovery. The existing peer
messages and coordinate contracts line up with Windows. Mac owns per-window
virtual displays; Windows owns one shared VDD. That implementation difference
does not require a wire change. No shared protocol files changed in this merge.

## Candidate validation

- 10 Mac JavaScript tests passed on Windows against the merged tree.
- 84 targeted Windows JavaScript tests passed, including failed placement,
  last-window display release, escaped-window withdrawal, and pending setup
  cancellation.
- Windows native helpers must be compiled when packaging this candidate.
- Native macOS compilation/signing must be performed on the Mac at this exact
  integration commit. Prior Mac binary signatures do not validate this build.
- This is a test candidate, not a declaration that paired tests passed.

## Live test limits and review observations

1. Mac's automatic caption detector uses Accessibility roles and a narrow
   title-bar region. Fast dragging, custom captions, and Finder unified toolbar
   hits require real testing, including input forwarded from the Windows mouse.
2. Mac's receiver is frameless for crossed Windows sources and intercepts
   Command-M for destination minimize; Windows retains a native receiving frame
   for Finder. Source caption buttons remain visible in captures. Test their
   behavior separately from destination controls; caption parity is unresolved.
3. Check Mac identity updates, its hide-on-minimize/Dock restore path, and the
   Windows Finder icon on a real taskbar. Mock success is insufficient.
4. Scarlett was enlarged during an earlier live test. A source larger than the
   Windows VDD is now rejected rather than left partially on physical screens.
   Restore a reasonable source size before the Scarlett transfer test. This does
   not otherwise change the source-resizing feature Travis elected to keep.
5. Run disconnect, policy-off, quit, capture failure, and physical display-loss
   checks with a popup open and two transferred windows. A forced helper kill
   bypasses Windows EOF restoration; recovery under that failure is not proven.
6. Mouse loss remains unresolved. Start with TCP on both test profiles and
   record the transport; test UDP as a separate case. Never interpret a successful
   transfer as proof that repeated crossing/reconnect is reliable.

## Mac handoff

Fetch `network-monitor-integration`, preserve local changes, and create an
isolated worktree at the exact candidate commit supplied in the handoff. Do not
rebase the candidate onto the Mac branch or add unreviewed commits for this
paired test. Read `paired-build.json`, build ARM64 with `MAC_ADHOC_SIGN=1 npm run
dist`, verify the signature, and record the full integration SHA and release ID
alongside the output. Report build success and any blockers. Keep subsequent
fixes on `mac-network-monitor` and submit them for a new paired candidate.
