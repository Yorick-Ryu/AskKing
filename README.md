# AskKing

AskKing is a Codex iOS approval relay. It provides:

- A local TypeScript/Hono Relay backed by SQLite.
- A Codex plugin with hooks and a Python hook adapter for `PermissionRequest`, `Stop`, and `UserPromptSubmit`.
- A SwiftUI iOS client for pairing, approvals, completion events, and continuation replies.
- Notification actions for approval allow/deny and completion text replies.

## Local Setup

Install dependencies:

```sh
pnpm install
```

Create local environment settings:

```sh
cp .env.example .env
```

Edit `.env` with your local admin token and optional APNs values. The Relay reads `.env` automatically when running local commands, and shell-provided environment variables still take precedence.

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

Start the Relay:

```sh
npx askking@latest
```

Open `ios/AskKing/AskKing.xcodeproj` in Xcode, set your development team and bundle id, run on an iPhone, then connect:

- Tap scan pairing QR code.
- Scan the QR code printed by `npx askking@latest`.

The QR code contains the Mac LAN Relay URL and a short-lived pairing code, so the iOS app does not need LAN service discovery for the normal setup flow. Bonjour discovery is still published as a fallback; disable it with `ASKKING_BONJOUR_ENABLED=0`, or rename the advertised service with `ASKKING_BONJOUR_NAME`.

The plugin lives at [plugins/askking](plugins/askking). It includes the hook definitions, an AskKing skill, and a hook entrypoint that reads the generated local Relay token from `~/.codex/askking/config.json`.

For the complete startup, pairing, APNs, and hook installation flow, see [docs/end-to-end-setup.md](https://github.com/Yorick-Ryu/AskKing/blob/main/docs/end-to-end-setup.md).

Admin endpoints can list and revoke paired clients/devices:

```sh
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" http://localhost:8787/api/admin/clients
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" -X POST http://localhost:8787/api/admin/clients/<id>/revoke
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" http://localhost:8787/api/admin/devices
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" -X POST http://localhost:8787/api/admin/devices/<id>/revoke
```

The iOS app registers APNs categories for notification actions:

- `ASKKING_APPROVAL`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_APPROVAL_REVIEW`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_COMPLETION`: `ASKKING_REPLY`

The Relay APNs payloads already use these categories, so lock-screen actions can submit decisions or continuation replies when the iPhone can reach the Relay URL.

## APNs

APNs is disabled by default so the local API loop can be tested without Apple credentials. Enable it with:

```sh
ASKKING_APNS_ENABLED=1
ASKKING_APNS_KEY_ID=...
ASKKING_APNS_TEAM_ID=...
ASKKING_APNS_TOPIC=app.askking.relay
ASKKING_APNS_KEY_PATH=/path/to/AuthKey_XXXX.p8
```

Use `ASKKING_APNS_PRODUCTION=1` only for a production-signed app.

On AWS Lambda, prefer Secrets Manager instead of a local key path:

```sh
ASKKING_APNS_KEY_SECRET_ID=arn:aws:secretsmanager:...:secret:askking/apns-...
```

## Public Deployment Path

The local Relay keeps business logic behind storage and push interfaces. The public deployment path is AWS Lambda + DynamoDB:

- Lambda entrypoint: [relay/src/lambda.ts](relay/src/lambda.ts).
- DynamoDB store: [relay/src/dynamo-store.ts](relay/src/dynamo-store.ts).
- SAM template: [infra/aws-sam/template.yaml](infra/aws-sam/template.yaml).
- Deployment notes: [docs/aws-lambda-deployment.md](https://github.com/Yorick-Ryu/AskKing/blob/main/docs/aws-lambda-deployment.md).

The public adapter:

- Uses `hono/aws-lambda`.
- Replaces SQLite with DynamoDB tables for clients, devices, approvals, completions, and pairing codes.
- Use DynamoDB TTL for approval and completion expiry.
- Keep APNs private key in AWS Secrets Manager or SSM Parameter Store.
- Avoids long Lambda waits from hooks; the hook keeps polling in short requests.

Cloudflare Workers remains a follow-up adapter because direct APNs HTTP/2 behavior must be verified separately.
