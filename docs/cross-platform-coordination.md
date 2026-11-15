# Cross-platform integration

Shared fork: https://github.com/travisisgood/TwinDesk

## Branches and ownership

- `windows-network-monitor`: Windows implementation, Windows helper and tests,
  `docs/windows-network-monitor.md`.
- `mac-network-monitor`: macOS implementation, Mac helper and tests,
  `docs/mac-network-monitor.md`.
- `network-monitor-integration`: reviewed changes from both platform branches.
  Windows is the integration owner, reflecting Travis's primary test machine.

Use separate local checkouts/worktrees. Never reset, clean, overwrite, or force
push another agent's work. Preserve uncommitted work before switching branches.
Changes to `shared/`, wire formats, root build/version configuration, or this
coordination agreement require a cross-platform review before integration.

## Review and handoff

1. Fetch the fork before each review. Inspect the other branch's actual diff,
   platform notes, and tests; do not rely solely on a chat summary.
2. Each handoff names the branch, full commit, behavior changed, message/field
   changes, tests run, live tests still needed, and known limitations.
3. Put review findings or questions in a pull request targeting
   `network-monitor-integration`, or a platform-specific review document in the
   author's own branch. Do not silently modify the other platform's files.
4. Windows reviews Mac changes; Mac reviews Windows changes. Resolve contract
   mismatches before merging. No passing test claim without its actual result.
5. Merge agreed commits into integration without rewriting branch history.
   Both platforms build paired candidates from the same integration commit.

## Paired versions

Build 01–05 are historical Windows-only test iteration names, not paired release
versions. A paired candidate must record one shared release identifier, the
integration commit and each platform's source commit. Display platform and
commit alongside the shared identifier in build metadata. A candidate becomes
validated only after tests on both platforms; matching labels alone are not
compatibility evidence. Runtime version/capability negotiation is future work
and must be agreed before changing messages.

## Required acceptance checks

- Mouse/keyboard crossing both ways, including emergency return and reconnect.
- Scarlett and Explorer from Windows; Finder from Mac. Normal title-bar drag.
- Individual native receiving containers, original app icons, local receiving
  Dock/taskbar minimize and restore. No whole-desktop takeover.
- Source stays on its backing virtual display during input and idle. Physical
  mouse geometry excludes that display without preventing remote app input.
- Popups, focus, keyboard input, return drag, disconnect and quit recovery.
- REAPER FX and nonstandard owned/child windows explicitly tested before claims.
- Keep Scarlett audio settings unchanged during interaction checks.

## Initial integration status

The initial integration branch contains the Windows baseline and this agreement;
it is NOT yet a validated paired build. Windows baseline: `5edaf6e`.
Mac branch discovered at `84135c6`; its changes still need cross-platform review
and integration. No Mac changes were merged merely to establish the branch.

The currently running Windows test profile uses TCP input diagnostically after
repeated UDP lane restarts and reported cursor loss. This is a local setting,
not a shared protocol change or proof that the cursor problem is fixed.
Do not use recurring AI polling to wait for the other platform.
