# Codex Done

Codex Done is a lightweight iOS completion notifier for Codex. It provides:

- iPhone completion notifications for Codex `Stop` hooks.
- A Relay API that can run locally for development or on Cloudflare Workers for public use.
- An iOS app that creates a device notification token and a copyable Codex setup prompt.

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

For public use, install Codex Done on iPhone first. On first launch it creates a device notification token. Copy the setup prompt from the iOS app and paste it into Codex on the computer; the important command is:

```sh
npx askking@latest configure https://your-api.example.com cdx_...
```

That writes `~/.codex/askking/config.json`. After the Codex Done plugin is enabled and the Stop hook is trusted, the computer can send completion notifications directly to that iPhone token. The computer does not need a local Relay or SQLite database.

For local development from a repository checkout, install dev dependencies and start the Relay:

```sh
pnpm install
pnpm dev
```

Open `ios/AskKing/AskKing.xcodeproj` in Xcode, set your development team and bundle id, run Codex Done on an iPhone, then connect:

- Let the app generate a notification token.
- Copy the setup prompt from the app into Codex on the computer.

Bonjour discovery is still published as a fallback for local development; disable it with `ASKKING_BONJOUR_ENABLED=0`, or rename the advertised service with `ASKKING_BONJOUR_NAME`.

For public deployment, the Cloudflare path uses one D1 database. Device session tokens and Codex notification tokens are stored only as hashes. Completion notifications are not stored.

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
