# Local Deployment

This guide covers the local LAN development flow:

- Start the Relay on the Mac.
- Pair the iOS app over the same Wi-Fi/LAN.
- Connect Codex hooks to the Relay.
- Receive approvals and completion replies in the app without APNs.

## Requirements

- Node.js 20 or newer.
- pnpm.
- Python 3 for the Codex hook adapter.
- Xcode 16 or newer for the iOS client.
- An iPhone and the Mac on the same Wi-Fi/LAN for device testing.
- An Apple Developer account only if real APNs remote notifications are enabled later.

## Relay Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASKKING_PORT` | `8787` | Local Relay port. |
| `ASKKING_DB` | `./askking.sqlite` | SQLite database path. |
| `ASKKING_PUBLIC_BASE_URL` | `http://localhost:8787` | URL returned to paired clients. |
| `ASKKING_ADMIN_TOKEN` | `dev-admin-token` | Admin API bearer token. |
| `ASKKING_APNS_ENABLED` | `0` | Send real APNs pushes when set to `1`. |

For iPhone testing, `ASKKING_PUBLIC_BASE_URL` must be a LAN URL reachable by the phone, for example `http://192.168.3.115:8787`. The Relay now defaults this value to the first non-loopback IPv4 address, but setting it explicitly makes the startup state easier to verify.

## Restart Local Relay

Find the Mac LAN IP:

```sh
ifconfig
```

Use the active Wi-Fi interface, usually `en0`, and copy the `inet` address. Ignore `127.0.0.1` and VPN ranges such as `198.18.0.1`.

Start the Relay from the repository root:

```sh
cd /Users/yorick/AIProjects/AskKing
ASKKING_ADMIN_TOKEN=change-me ASKKING_PUBLIC_BASE_URL=http://<mac-lan-ip>:8787 pnpm dev
```

Keep this terminal open. Verify from the Mac:

```sh
curl http://<mac-lan-ip>:8787/health
```

A healthy Relay returns JSON with `ok: true`.

## Pair iOS App

Open a second terminal and create a short-lived pairing code:

```sh
cd /Users/yorick/AIProjects/AskKing
ASKKING_ADMIN_TOKEN=change-me ASKKING_PUBLIC_BASE_URL=http://<mac-lan-ip>:8787 pnpm relay:pair
```

The command prints:

```text
Pairing code: <code>
Expires at: <timestamp>
```

In the iOS app:

1. Set the Relay URL to `http://<mac-lan-ip>:8787`.
2. Or tap "自动发现局域网 Relay" when the Mac and iPhone are on the same LAN.
3. Enter the pairing code.
4. Tap "配对设备".

Pairing codes are short-lived and single-use. Generate a new code if the app reports that the code is invalid or expired.

The local app flow uses in-app polling, so notification permission and APNs credentials are not required for local testing.

## Connect Codex Hooks

Create a Codex client token if one has not already been created:

```sh
cd /Users/yorick/AIProjects/AskKing
ASKKING_PUBLIC_BASE_URL=http://<mac-lan-ip>:8787 pnpm relay:client
```

Copy the printed `Client token` into the Codex hook config. Since Codex runs on the same Mac as the Relay, the hook can use `localhost`:

```toml
[hooks.PermissionRequest]
command = "ASKKING_RELAY_URL=http://localhost:8787 ASKKING_CLIENT_TOKEN=<client-token> /Users/yorick/AIProjects/AskKing/hooks/askking_codex_hook.py"

[hooks.Stop]
command = "ASKKING_RELAY_URL=http://localhost:8787 ASKKING_CLIENT_TOKEN=<client-token> /Users/yorick/AIProjects/AskKing/hooks/askking_codex_hook.py"

[hooks.UserPromptSubmit]
command = "ASKKING_RELAY_URL=http://localhost:8787 ASKKING_CLIENT_TOKEN=<client-token> /Users/yorick/AIProjects/AskKing/hooks/askking_codex_hook.py"
```

Use the LAN URL for the iPhone, and use `localhost` for Codex hooks running on the same Mac.

Set `ASKKING_STOP_MODE=notify_only` on the `Stop` hook command when you want completion notifications without blocking the Mac Codex UI. In that mode the `UserPromptSubmit` hook still syncs the next Mac-local prompt back to the Relay so the iOS status changes to `replied`.

## Manual API Smoke Test

```sh
CLIENT_TOKEN=...
curl -H "authorization: Bearer $CLIENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"projectName":"Smoke","commandSummary":"echo hello","ttlSeconds":60}' \
  http://localhost:8787/api/codex/approvals
```

Pair the iOS app, open the approval, then allow or deny it. The Codex wait endpoint returns the first valid decision and ignores repeated decisions.

## Troubleshooting

If the iPhone cannot connect:

- Confirm the Mac and iPhone are on the same Wi-Fi/LAN.
- Open `http://<mac-lan-ip>:8787/health` from Safari on the iPhone.
- Confirm the Relay terminal is still running.
- Confirm port `8787` is not blocked by the macOS firewall or VPN.
- Generate a fresh pairing code if the previous one expired or was already used.

If the Relay URL in the app still shows `localhost`, tap "自动发现局域网 Relay" or replace it with the Mac LAN URL manually.

If Codex hooks do not trigger the app, confirm `ASKKING_CLIENT_TOKEN` is the token from `pnpm relay:client`, not the iOS pairing code.

## Notification Actions

The iOS client registers:

- Approval actions: allow and deny.
- Completion action: text input reply.

These actions call the same authenticated mobile APIs as the in-app detail screens. They require the paired iPhone to reach the Relay URL at action time. On a LAN deployment, use the Mac or server LAN IP instead of `localhost` in the iOS app.

## Codex Hook Safety

`hooks/askking_codex_hook.py` is conservative:

- Missing `ASKKING_CLIENT_TOKEN` returns `{}` so Codex can use its normal permission flow.
- Relay errors return `{}` so Codex can use its normal permission flow.
- Approval timeout returns `{}` so Codex can use its normal permission flow.
- `Stop` hook relay errors return `{}` so Codex can end normally.
- `Stop` can run in `ASKKING_STOP_MODE=notify_only` to notify and return immediately.
- `UserPromptSubmit` syncs the next Mac-local prompt to the latest matching completion event.

The hook output follows the current official Codex hook shape verified on 2026-05-28:

- `PermissionRequest`: `hookSpecificOutput.hookEventName = "PermissionRequest"` and `decision.behavior = "allow" | "deny"`.
- `Stop` continuation: top-level `decision = "block"` and `reason = <continuation prompt>`.
