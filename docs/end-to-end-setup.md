# End-to-End Setup

This guide covers the full AskKing flow:

- Configure a remote Cloudflare Relay or local development Relay.
- Pair the iOS app.
- Enable APNs notification delivery.
- Install the AskKing Codex plugin and trust its hooks.
- Verify approvals, completion notifications, and replies.

## 1. Install Dependencies

From the repository root:

```sh
cd /Users/yorick/AIProjects/AskKing
pnpm install
```

## 2. Public Cloudflare Path

After deploying the Cloudflare Worker Relay, create a Codex client and configure local hooks:

```sh
ASKKING_RELAY_URL=https://your-worker.workers.dev \
ASKKING_ADMIN_TOKEN=<admin-token> \
  npx askking@latest client

npx askking@latest configure https://your-worker.workers.dev <client-token>
npx askking@latest pair
```

In this path the local machine only needs the Codex plugin hooks and `~/.codex/askking/config.json`. It does not need a local Relay or SQLite database.

## 3. Local Development Relay

Create `.env` only when running the development Relay locally.

Create a local environment file:

```sh
cp .env.example .env
```

Edit `.env`. For basic local polling, these values are enough:

```sh
ASKKING_PORT=8787
ASKKING_DB=./askking.sqlite
ASKKING_ADMIN_TOKEN=change-me
ASKKING_CLIENT_NAME=Local Codex
ASKKING_BONJOUR_ENABLED=1
ASKKING_BONJOUR_NAME=AskKing Relay
ASKKING_APNS_ENABLED=0
```

For real APNs notifications, fill these values too:

```sh
ASKKING_APNS_ENABLED=1
ASKKING_APNS_KEY_ID=ABC123DEFG
ASKKING_APNS_TEAM_ID=HYB659G8FH
ASKKING_APNS_TOPIC=app.askking.relay
ASKKING_APNS_KEY_PATH=/Users/yorick/Downloads/AuthKey_ABC123DEFG.p8
ASKKING_APNS_PRODUCTION=0
```

Use `ASKKING_APNS_PRODUCTION=0` for Xcode development builds. Use `1` only for production APNs builds such as TestFlight or App Store.

`ASKKING_PUBLIC_BASE_URL` can usually stay unset. The Relay will choose the first non-loopback LAN IPv4 address. If the iPhone cannot connect, set it explicitly:

```sh
ASKKING_PUBLIC_BASE_URL=http://<mac-lan-ip>:8787
```

## 4. Start Local Development Relay

Start the Relay:

```sh
pnpm dev
```

Keep this terminal running.

On first startup with no paired devices, the Relay prints a QR code that contains the Mac LAN Relay URL and a short-lived pairing code. The iOS app can scan this code and pair without LAN service discovery.

Bonjour is still published as a fallback with service type `_askking._tcp`. Set `ASKKING_BONJOUR_ENABLED=0` to disable this, or `ASKKING_BONJOUR_NAME=<name>` to change the advertised name.

Check health from the Mac:

```sh
curl http://localhost:8787/health
```

Check health from iPhone Safari with the LAN URL:

```text
http://<mac-lan-ip>:8787/health
```

The iPhone must be able to open that URL before pairing or notification actions can work.

## 5. Pair iPhone

In the iOS app:

1. Tap scan pairing QR code.
2. Scan the QR code printed by `pnpm dev`.
3. Allow notification permission when prompted, or request it later from Settings.

Pairing code is for the iPhone only. It is short-lived and single-use.

## 6. Enable Apple Push Notifications

This step is only needed for lock-screen/banner notifications. In-app polling works without APNs.

Apple Developer setup:

1. Open Apple Developer Account.
2. Enable Push Notifications for App ID `app.askking.relay`.
3. Create an APNs key under Certificates, Identifiers & Profiles -> Keys.
4. Configure the key as `Sandbox` for local Xcode development.
5. Use `Team Scoped (All Topics)` unless you specifically want topic restrictions.
6. Download `AuthKey_XXXXXXXXXX.p8`.

Map Apple values to `.env`:

```sh
ASKKING_APNS_KEY_ID=XXXXXXXXXX
ASKKING_APNS_TEAM_ID=HYB659G8FH
ASKKING_APNS_TOPIC=app.askking.relay
ASKKING_APNS_KEY_PATH=/absolute/path/to/AuthKey_XXXXXXXXXX.p8
```

Xcode project requirements:

- Bundle identifier must match `ASKKING_APNS_TOPIC`.
- Push Notifications capability must be enabled.
- Entitlements must include `aps-environment = development` for local builds.
- Run on a real iPhone. Remote APNs delivery cannot be fully tested on a normal simulator flow.

After changing APNs values, restart the Relay.

## 7. Install AskKing Codex Plugin

Install and trust the AskKing Codex plugin:

1. Add the AskKing marketplace from the shell:

    ```sh
    codex plugin marketplace add Yorick-Ryu/AskKing
    ```

2. Open Codex:

    ```sh
    codex
    ```

3. In Codex, open the plugin browser:

    ```text
    /plugins
    ```

    In the plugin browser, find AskKing and install or enable it.

4. After AskKing is enabled, restart Codex if requested, then run:

    ```text
    /hooks
    ```

    Review and trust the AskKing hooks.

The AskKing plugin is packaged in this repository:

```text
plugins/askking
```

It includes:

- `hooks/hooks.json`: Codex lifecycle hook definitions.
- `scripts/askking_codex_hook.py`: Codex hook entrypoint that reads `~/.codex/askking/config.json`.
- `skills/askking/SKILL.md`: AskKing setup and mode-control skill.

The repo-local marketplace entry is:

```text
.agents/plugins/marketplace.json
```

Codex requires this review for command hooks, including hooks supplied by plugins.

Optional hook environment variables:

```sh
ASKKING_APPROVAL_TIMEOUT_SECONDS=600
ASKKING_STOP_WAIT_SECONDS=600
ASKKING_HOOK_MODE=full
ASKKING_COMPLETION_SUMMARY_LIMIT=4000
```

`ASKKING_HOOK_MODE` controls the overall AskKing hook behavior:

- `off`: no AskKing behavior. Permission and completion hooks return immediately without creating AskKing events.
- `notify`: send non-actionable approval/completion notifications without persisting approval/completion records, and leave approval and continuation control in Codex.
- `approval`: hand off approval decisions to iPhone, and only notify completions.
- `full`: hand off approval decisions to iPhone, notify completions, and wait for iPhone continuation replies.

You can change the mode while Codex is running:

```sh
npx askking@latest mode off
npx askking@latest mode notify
npx askking@latest mode approval
npx askking@latest mode full
npx askking@latest mode
```

The command writes the mode to the configured Relay for the current Codex client. Hooks ask the Relay for the current mode every time they run, and long approval/completion waits re-read it while waiting, so changing from `full` to `notify` or `off` releases the current wait.

`ASKKING_HOOK_MODE` overrides the Relay mode when set. If neither is set, AskKing defaults to `notify`.

## 8. Verify Flow

Approval flow:

1. Trigger a Codex action that requires approval.
2. Relay creates an approval event.
3. iPhone receives it through polling and, if APNs is enabled, a notification.
4. Approve or deny in the app, or from the notification action.
5. Codex receives allow or deny from the hook.

Completion flow:

1. Let a Codex turn finish.
2. Stop hook creates a completion event.
3. iPhone receives it through polling and, if APNs is enabled, a notification.
4. Reply with the next instruction in the app or notification.
5. In `full` mode, the hook returns that reply to Codex as a continuation prompt.

Manual approval smoke test:

```sh
CLIENT_TOKEN=<client-token>
curl -H "authorization: Bearer $CLIENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"projectName":"Smoke","commandSummary":"echo hello","ttlSeconds":60}' \
  http://localhost:8787/api/codex/approvals
```

Manual completion smoke test:

```sh
CLIENT_TOKEN=<client-token>
curl -H "authorization: Bearer $CLIENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"projectName":"Smoke","summary":"Smoke completed","ttlSeconds":60}' \
  http://localhost:8787/api/codex/completions
```
