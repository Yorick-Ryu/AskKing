# Design and Development Notes

This document keeps implementation and deployment design notes separate from the usage-focused README.

## Repository Components

AskKing is composed of:

- A local TypeScript/Hono Relay backed by SQLite.
- A Codex plugin with hooks and a Python hook adapter for `PermissionRequest`, `Stop`, and `UserPromptSubmit`.
- A SwiftUI iOS client for pairing, approvals, completion events, and continuation replies.
- Notification actions for approval allow/deny and completion text replies.

The plugin lives at [plugins/askking](../plugins/askking). It includes the hook definitions, an AskKing skill, and a hook entrypoint that reads the generated local Relay token from `~/.codex/askking/config.json`.

## APNs Implementation

APNs is disabled by default so the local API loop can be tested without Apple credentials.

The iOS app registers APNs categories for notification actions:

- `ASKKING_APPROVAL`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_APPROVAL_REVIEW`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_COMPLETION`: `ASKKING_REPLY`

The Relay APNs payloads already use these categories, so lock-screen actions can submit decisions or continuation replies when the iPhone can reach the Relay URL.

Use `ASKKING_APNS_PRODUCTION=1` only for a production-signed app.

On AWS Lambda, prefer Secrets Manager instead of a local key path:

```sh
ASKKING_APNS_KEY_SECRET_ID=arn:aws:secretsmanager:...:secret:askking/apns-...
```

## Public Deployment Path

The local Relay keeps business logic behind storage and push interfaces. The public deployment path is AWS Lambda + DynamoDB:

- Lambda entrypoint: [relay/src/lambda.ts](../relay/src/lambda.ts).
- DynamoDB store: [relay/src/dynamo-store.ts](../relay/src/dynamo-store.ts).
- SAM template: [infra/aws-sam/template.yaml](../infra/aws-sam/template.yaml).
- Deployment notes: [docs/aws-lambda-deployment.md](aws-lambda-deployment.md).

The public adapter:

- Uses `hono/aws-lambda`.
- Replaces SQLite with DynamoDB tables for clients, devices, approvals, completions, and pairing codes.
- Uses DynamoDB TTL for approval and completion expiry.
- Keeps the APNs private key in AWS Secrets Manager or SSM Parameter Store.
- Avoids long Lambda waits from hooks; the hook keeps polling in short requests.

Cloudflare Workers remains a follow-up adapter because direct APNs HTTP/2 behavior must be verified separately.
