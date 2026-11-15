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
