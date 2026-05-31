# AskKing

AskKing is a Codex iOS approval relay MVP. It provides:

- A local TypeScript/Hono Relay backed by SQLite.
- A Codex plugin with hooks and a Python hook adapter for `PermissionRequest`, `Stop`, and `UserPromptSubmit`.
- A SwiftUI iOS client for pairing, approvals, completion events, and continuation replies.
- Notification actions for approval allow/deny and completion text replies.

## Local MVP

Install dependencies:

```sh
pnpm install
```

Create local environment settings:

```sh
cp .env.example .env
```

Edit `.env` with your local admin token and optional APNs values. The Relay reads `.env` automatically when running local commands, and shell-provided environment variables still take precedence.

Add the AskKing plugin marketplace:

```sh
codex plugin marketplace add Yorick-Ryu/AskKing
codex
/plugins
```

Install AskKing from the plugin browser. The hooks are bundled with the plugin and load automatically after the plugin is enabled. The local Relay creates the Codex client config automatically when it starts. Restart Codex if requested, then run `/hooks` to review and trust the AskKing hooks. This is required by Codex's hook safety model.

Start the Relay:

```sh
npx askking@latest
```

Create a short-lived iOS pairing code:

```sh
npx askking@latest pair
```

Open `ios/AskKing/AskKing.xcodeproj` in Xcode, set your development team and bundle id, run on an iPhone, then connect:

- Tap automatic discovery to find the local Relay over Bonjour.
- Or enter the Mac LAN address manually, for example `http://192.168.1.23:8787`.
- Pairing code: the code printed by `npx askking@latest pair`

Bonjour discovery publishes `_askking._tcp` from the local Relay. Disable it with `ASKKING_BONJOUR_ENABLED=0`, or rename the advertised service with `ASKKING_BONJOUR_NAME`.

The plugin lives at [plugins/askking](plugins/askking). It includes the hook definitions, an AskKing skill, and a hook entrypoint that reads the generated local Relay token from `~/.codex/askking/config.json`.

For the complete startup, pairing, APNs, and hook installation flow, see [docs/end-to-end-setup.md](docs/end-to-end-setup.md).

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

The local Relay keeps business logic behind storage and push interfaces. The MVP public path is AWS Lambda + DynamoDB:

- Lambda entrypoint: [relay/src/lambda.ts](relay/src/lambda.ts).
- DynamoDB store: [relay/src/dynamo-store.ts](relay/src/dynamo-store.ts).
- SAM template: [infra/aws-sam/template.yaml](infra/aws-sam/template.yaml).
- Deployment notes: [docs/aws-lambda-deployment.md](docs/aws-lambda-deployment.md).

The public adapter:

- Uses `hono/aws-lambda`.
- Replaces SQLite with DynamoDB tables for clients, devices, approvals, completions, and pairing codes.
- Use DynamoDB TTL for approval and completion expiry.
- Keep APNs private key in AWS Secrets Manager or SSM Parameter Store.
- Avoids long Lambda waits from hooks; the hook keeps polling in short requests.

Cloudflare Workers remains a follow-up adapter because direct APNs HTTP/2 behavior must be verified separately.
