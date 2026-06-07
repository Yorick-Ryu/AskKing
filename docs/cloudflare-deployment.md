# Cloudflare Workers + D1 Deployment

This is the public deployment path for AskKing. It runs the Hono API on Cloudflare Workers and uses one D1 database for client tokens, device bindings, client-scoped settings, and short-lived approval/completion state.

## Build

```sh
pnpm install
pnpm typecheck
```

## D1

Create the database once:

```sh
pnpm exec wrangler d1 create askking-relay
```

Copy the returned `database_id` into `wrangler.toml`, then apply migrations:

```sh
pnpm exec wrangler d1 migrations apply askking-relay --remote
```

The initial migration creates:

- `codex_clients`
- `devices`
- `pairing_codes`
- `approvals`
- `completions`
- `settings`

## Secrets

Set production secrets with Wrangler:

```sh
pnpm exec wrangler secret put ASKKING_ADMIN_TOKEN
pnpm exec wrangler secret put ASKKING_APNS_KEY
```

`ASKKING_APNS_KEY` should contain the full APNs `.p8` private key. Keep `ASKKING_APNS_ENABLED=0` until Apple Push Notification credentials are ready.

## Deploy

```sh
pnpm exec wrangler deploy
```

After the first deploy, set `ASKKING_PUBLIC_BASE_URL` in `wrangler.toml` to the deployed Worker URL and deploy again. The iOS pairing response uses this value as the relay base URL.

## Bootstrap

Create a Codex client over HTTPS:

```sh
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Public Codex","defaultProjectName":"AskKing"}' \
  https://your-worker.workers.dev/api/admin/clients
```

Configure local Codex hooks:

```sh
npx askking@latest configure https://your-worker.workers.dev <returned-client-token>
npx askking@latest pair
```

After `configure`, local Codex hooks read `~/.codex/askking/config.json` and talk directly to the Cloudflare Relay. No local Relay or local database is required for `notify`, `approval`, or `full`.

## Verification

Run the API smoke against the deployed Worker:

```sh
ASKKING_SMOKE_BASE_URL=https://your-worker.workers.dev \
ASKKING_ADMIN_TOKEN=$ASKKING_ADMIN_TOKEN \
  pnpm smoke:remote
```
