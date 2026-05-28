# Local Deployment

## Requirements

- Node.js 20 or newer.
- pnpm.
- Python 3 for the Codex hook adapter.
- Xcode 16 or newer for the iOS client.
- An Apple Developer account for real APNs remote notifications.

## Relay Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASKKING_PORT` | `8787` | Local Relay port. |
| `ASKKING_DB` | `./askking.sqlite` | SQLite database path. |
| `ASKKING_PUBLIC_BASE_URL` | `http://localhost:8787` | URL returned to paired clients. |
| `ASKKING_ADMIN_TOKEN` | `dev-admin-token` | Admin API bearer token. |
| `ASKKING_APNS_ENABLED` | `0` | Send real APNs pushes when set to `1`. |

For iPhone testing, set `ASKKING_PUBLIC_BASE_URL` to a LAN URL reachable by the phone.

## Manual API Smoke Test

```sh
CLIENT_TOKEN=...
curl -H "authorization: Bearer $CLIENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"projectName":"Smoke","commandSummary":"echo hello","ttlSeconds":60}' \
  http://localhost:8787/api/codex/approvals
```

Pair the iOS app, open the approval, then allow or deny it. The Codex wait endpoint returns the first valid decision and ignores repeated decisions.

## Notification Actions

The iOS client registers:

- Approval actions: allow and deny.
- Completion action: text input reply.

These actions call the same authenticated mobile APIs as the in-app detail screens. They require the paired iPhone to reach the Relay URL at action time. On a LAN deployment, use the Mac or server LAN IP instead of `localhost` in the iOS app.

## Codex Hook Safety

`hooks/askking_codex_hook.py` is conservative:

- Missing `ASKKING_CLIENT_TOKEN` denies `PermissionRequest`.
- Relay errors deny `PermissionRequest`.
- Approval timeout denies `PermissionRequest`.
- `Stop` hook relay errors return `{}` so Codex can end normally.

The hook output follows the current official Codex hook shape verified on 2026-05-28:

- `PermissionRequest`: `hookSpecificOutput.hookEventName = "PermissionRequest"` and `decision.behavior = "allow" | "deny"`.
- `Stop` continuation: `hookSpecificOutput.hookEventName = "Stop"`, `decision = "block"`, and `reason = <continuation prompt>`.
