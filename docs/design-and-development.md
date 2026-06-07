# Design and Development Notes

This document keeps implementation and deployment design notes separate from the usage-focused README.

## Repository Components

AskKing is composed of:

- A TypeScript/Hono Relay API that can run locally for development or on Cloudflare Workers for public use.
- A Codex plugin with hooks and a Python hook adapter for `PermissionRequest`, `Stop`, and `UserPromptSubmit`.
- A SwiftUI iOS client for pairing, approvals, completion events, and continuation replies.
- Notification actions for approval allow/deny and completion text replies.

The plugin lives at [plugins/askking](../plugins/askking). It includes the hook definitions, an AskKing skill, and a hook entrypoint that reads the configured Relay URL and client token from `~/.codex/askking/config.json` or environment variables.

## APNs Implementation

APNs is disabled by default so the local API loop can be tested without Apple credentials.

The iOS app registers APNs categories for notification actions:

- `ASKKING_APPROVAL`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_APPROVAL_REVIEW`: `ASKKING_ALLOW`, `ASKKING_DENY`
- `ASKKING_COMPLETION`: `ASKKING_REPLY`

The Relay APNs payloads already use these categories, so lock-screen actions can submit decisions or continuation replies when the iPhone can reach the Relay URL.

Use `ASKKING_APNS_PRODUCTION=1` only for a production-signed app.

On Cloudflare Workers, store the APNs key as a Worker secret:

```sh
pnpm exec wrangler secret put ASKKING_APNS_KEY
```

## Public Deployment Path

The Relay keeps business logic behind storage and push interfaces. The public deployment path is Cloudflare Workers + D1:

- Worker entrypoint: [relay/src/worker.ts](../relay/src/worker.ts).
- D1 store: [relay/src/d1-store.ts](../relay/src/d1-store.ts).
- D1 migrations: [migrations](../migrations).
- Deployment notes: [docs/cloudflare-deployment.md](cloudflare-deployment.md).

The public adapter:

- Uses Hono's standard `fetch` interface in a Worker module.
- Uses one D1 database for client token hashes, iOS session token hashes, client-scoped hook mode settings, pairing codes, approvals, and completions.
- Stores approvals and completions as short-lived records and deletes terminal records after the Codex hook consumes a decision or reply.
- Keeps hook mode scoped to each Codex client rather than global.
- Keeps the APNs private key in Cloudflare Worker secrets.
- Keeps the local development path on SQLite through [relay/src/store.ts](../relay/src/store.ts).
