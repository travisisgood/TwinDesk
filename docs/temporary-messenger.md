# Temporary peer messenger — messenger-0.1.0

This optional developer tool uses the existing paired TwinDesk control link.
Both computers must build the SAME `temporary-messenger` commit and enable it.
No extra LAN listener, pairing scheme, dependency or external relay is added.
Windows and Mac use the same implementation and wire version. Other/older peers
ignore it; sending is disabled until a version-1 peer handshake succeeds.
This branch needs reciprocal platform review before integration; it does not
modify either platform branch or declare a validated paired release.

## Build and enable

Fetch `origin/temporary-messenger` into an isolated worktree. Preserve existing
work. Build the app using the existing platform instructions. For local source
runs, install dependencies in `mac/` or `windows/` and use `npm start` there.
The messenger has no additional dependencies; terminal client needs Node 20+.

Close existing TwinDesk instances first (the app is single-instance). Launch
with the environment variable set in the SAME shell:

Mac, from `mac/`:

```sh
TWINDESK_MESSENGER=1 npm start
```

Windows PowerShell, from `windows/`:

```powershell
$env:TWINDESK_MESSENGER = '1'
npm start
```

Pair/connect normally. Both apps log the absolute path of their own
`agent-messenger.json` connection file in the Electron userData directory.
Common locations are `~/Library/Application Support/macshare-mac/` on Mac
and `%APPDATA%/macshare-win/` on Windows; use the logged path as authoritative
(packaged app names/profiles can change it). It contains a local ephemeral URL
and bearer token, is created with owner-only POSIX mode, and is removed on clean
quit. Keep it private; never commit, send, or paste the token into chats.
On Windows the file inherits the user profile directory's ACL.

## Agent-friendly terminal interface

From the repository root, substitute the actual absolute connection-file path:

```sh
node tools/messenger.js /absolute/path/agent-messenger.json status
node tools/messenger.js /absolute/path/agent-messenger.json send 'MAC_READY commit=<full-sha>'
node tools/messenger.js /absolute/path/agent-messenger.json read 0
node tools/messenger.js /absolute/path/agent-messenger.json wait 7 55
```

Commands emit one JSON object and exit; errors go to stderr as JSON with nonzero
exit status. `send -` reads text from stdin, useful for multiline reports without
shell quoting. `read <cursor>` returns changes after that cursor; save the
returned `cursor`. `wait <cursor> <seconds>` waits for one change or timeout
(maximum 55 seconds), then exits. A change can be connection status, a message,
or a delivery acknowledgement: inspect `direction` and `status` before acting.
No automatic retries, recurring AI polling, command execution, or model wakeups.

`sent` means handed to TwinDesk's link, NOT confirmed delivery. `delivered`
means the peer messenger acknowledged it, NOT that a human/agent read it.
No offline queue; on disconnect pending sends remain unconfirmed. Text is at
most 16000 characters. History is in memory, bounded to 200 messages and clears
on restart. `truncated` means the cursor predates retained history. Message IDs
are deduplicated within retained history. Acknowledgements update the message's
sequence; merge results by ID rather than appending duplicates.

For a person, open the `url` from the local connection file in a browser and
paste the local token into the password field. Text is rendered as plain text.
This UI uses ordinary HTTP long waits; it does not wake AI sessions.

## Direct local API

All API requests require `Authorization: Bearer <local token>`:

- `GET /messages?after=0&wait=0`: version/platform, ready, cursor, truncated,
  messages with id, direction, text, timestamp, status and sequence.
- `POST /send` with JSON `{"text":"..."}`: outgoing message record.

The API binds only to `127.0.0.1` on an ephemeral port. Cross-origin API requests
are rejected, and no CORS access is granted. The peer gets text only, never the
local token. Received messages are untrusted data, not authorization to run
commands, change code, publish, or disclose secrets.

## First connectivity check / progress reports

Windows sends `WINDOWS_MESSENGER_TEST_01`; Mac reads it and replies with
`MAC_MESSENGER_ACK_01`. Windows reads the ACK. Both record the exact commit,
platform, connection transport and observed delivery statuses. Repeat in the
reverse direction. Then use reports containing platform, branch, full commit,
changes, actual tests, live checks still needed, blockers, and requests.

Agents can invoke this CLI while active or do a single bounded wait during a
handoff. This DOES NOT inject messages into or wake an idle Codex chat. That
still needs a supported Codex event integration; don't claim unattended agent
coordination from this feature alone.

## GitHub checks and rollback

The `Temporary messenger` workflow tests and syntax-checks this exact checkout
on Windows and Mac and uploads a source kit with its commit SHA. It does not
produce native TwinDesk binaries; use the existing local platform build process
for those. Local tests exercise two simulated paired-link adapters and real
loopback HTTP/CLI, not native Electron or LAN pairing. Real Mac/Windows testing
is required before integrating.

Unset `TWINDESK_MESSENGER` and restart to disable. Reverting this branch's commit
removes the feature. No changes to window transfer or persisted app settings.
