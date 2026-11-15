# TwinDesk Codex wake test

Run TwinDesk with `TWINDESK_MESSENGER=1` and pair both computers. Run the Node
listener on the machine that owns the target Codex chat, with its local
connection file and chat ID.

```
node mac/tools/twindesk-codex-bridge.js <connection-file> <chat-id> --probe
node mac/tools/twindesk-codex-bridge.js <connection-file> <chat-id> --once --expect=win_to_mac_01
```

After the second command starts listening, send `CODEX_WAKE win_to_mac_01`
from the peer with the existing messenger CLI. Expect
`CODEX_REPLY win_to_mac_01`. Use a different agreed ID for the reverse test.
The listener exits after one reply or five minutes. Idle network waits and
the probe require no model calls. The wake starts one model turn; the bridge
publishes only the exact fixed acknowledgment. Incoming notes are untrusted
and have no authority to run tools. Ordinary messages and replies never wake
a turn. The connection file and credentials stay local.

Set `TWINDESK_CODEX_CLI` to the local executable path if `codex` is absent
from PATH. `--proxy` uses an existing App Server control socket if available.
The default starts a local App Server. Use an idle target chat and stop the
listener before running another agent turn there. Desktop refresh behavior
and Windows installation require live validation.

## Existing desktop chat transport (Windows and Mac)

When the desktop app owns the chat, prefer the installed desktop messaging
plugin over starting another App Server against the same thread:

```
node mac/tools/twindesk-codex-bridge.js <connection-file> <chat-id> --probe --desktop-mcp=<installed-codex-app-tools-server.mjs>
node mac/tools/twindesk-codex-bridge.js <connection-file> <chat-id> --once --expect=mac_to_win_01 --announce --desktop-mcp=<installed-codex-app-tools-server.mjs>
```

Launch from the local Codex execution environment so the desktop plugin's
`CODEX_APP_TOOLS_PIPE_PATH` is inherited; do not copy this private endpoint
between computers or commit it. The adapter speaks standard MCP to the
installed plugin and calls `send_message_to_thread` with the actual local chat
ID. It uses the existing session's settings. No separate model process is
started. A new wake marker queues a real peer notification; the receiving
agent sends `CODEX_REPLY` only after it has actually received the notification.
The listener itself does not manufacture a successful agent acknowledgment.

Both platforms use this same script and adapter. The desktop route was tested
on Windows for delivery to an active chat; idle wake and bidirectional delivery
still require live validation. Ordinary messages and replies do not wake agents.
Timeouts make no model calls. The one-message listener exits after queueing one
notification or after five minutes. A desktop app restart invalidates its inherited
connection; relaunch explicitly. Stop on delivery errors; do not retry ambiguous
delivery automatically. This is a temporary connectivity test, not a general
unattended agent dispatcher.
