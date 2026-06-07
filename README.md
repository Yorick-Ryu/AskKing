# Codex Done

Codex Done is a lightweight iOS completion notifier for Codex. It provides:

- iPhone completion notifications for Codex `Stop` hooks.
- A Relay API that can run locally for development or on Cloudflare Workers for public use.
- A read-only iOS app for pairing devices and reviewing completed Codex turns.

## Setup

Install dependencies:

```sh
pnpm install
```

Create local environment settings:

```sh
cp .env.example .env
```

Edit `.env` with your local admin token and optional APNs values. The Relay reads `.env` automatically when running local commands, and shell-provided environment variables still take precedence.

Install and trust the Codex Done plugin:

1. Add the marketplace from the shell:

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

    In the plugin browser, find Codex Done and install or enable it.

4. After Codex Done is enabled, restart Codex if requested, then run:

    ```text
    /hooks
    ```

    Review and trust the Codex Done hook.

For public use, deploy the Cloudflare Worker Relay, create a client, then configure local hooks with the remote URL and client token:

```sh
npx askking@latest configure https://your-api.example.com ck_...
npx askking@latest pair
```

The `pair` command calls the configured remote Relay and prints a short-lived iOS pairing code. In this path, the local machine only needs the Codex plugin hooks and `~/.codex/askking/config.json`; it does not need a local Relay or SQLite database.

For local development from a repository checkout, install dev dependencies and start the Relay:

```sh
pnpm install
pnpm dev
```

Open `ios/AskKing/AskKing.xcodeproj` in Xcode, set your development team and bundle id, run Codex Done on an iPhone, then connect:

- Tap scan pairing QR code.
- Scan the QR code printed by `pnpm dev`.

The local QR code contains the Mac LAN Relay URL and a short-lived pairing code, so the iOS app does not need LAN service discovery for the development flow. Bonjour discovery is still published as a fallback; disable it with `ASKKING_BONJOUR_ENABLED=0`, or rename the advertised service with `ASKKING_BONJOUR_NAME`.

For public deployment, the Cloudflare path uses one D1 database. Client and device tokens are stored only as hashes, and Codex completion records are short-lived notification records.

Admin endpoints can list and revoke paired clients/devices:

```sh
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" http://localhost:8787/api/admin/clients
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" -X POST http://localhost:8787/api/admin/clients/<id>/revoke
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" http://localhost:8787/api/admin/devices
curl -H "authorization: Bearer $ASKKING_ADMIN_TOKEN" -X POST http://localhost:8787/api/admin/devices/<id>/revoke
```

## APNs

APNs is disabled by default so the local API loop can be tested without Apple credentials. Enable it with:

```sh
ASKKING_APNS_ENABLED=1
ASKKING_APNS_KEY_ID=...
ASKKING_APNS_TEAM_ID=...
ASKKING_APNS_TOPIC=app.askking.relay
ASKKING_APNS_KEY_PATH=/path/to/AuthKey_XXXX.p8
```

See [docs/end-to-end-setup.md](https://github.com/Yorick-Ryu/AskKing/blob/main/docs/end-to-end-setup.md) for Apple Developer and Xcode setup details.

## More Docs

- Complete startup, pairing, APNs, and hook installation flow: [docs/end-to-end-setup.md](https://github.com/Yorick-Ryu/AskKing/blob/main/docs/end-to-end-setup.md)
- Cloudflare Workers + D1 deployment: [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md)
- Implementation and deployment design notes: [docs/design-and-development.md](docs/design-and-development.md)
