# AskKing

AskKing is a Codex iOS approval relay. It provides:

- iPhone approval and completion notifications for Codex.
- A local Relay that pairs Codex with the iOS app.
- Notification actions for approving, denying, and replying from iOS.

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
- Implementation and deployment design notes: [docs/design-and-development.md](docs/design-and-development.md)
