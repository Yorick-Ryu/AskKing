---
name: askking
description: "Use when the user asks to install or configure AskKing, pair the iOS app, generate Codex hook client tokens, start the AskKing Relay, or change AskKing hook modes."
---

# AskKing

## Mode Control

When the user asks to change the AskKing hook mode, set it immediately.

Run from the AskKing repository root:

```sh
npx askking@latest mode <mode>
```

Then report the resulting mode in one short sentence.

## Flow Commands

- Configure hooks for a remote Relay: `npx askking@latest configure <relayUrl> <clientToken>`
- Create a fresh iOS pairing code for the configured Relay: `npx askking@latest pair`
- Create a remote Codex client with an admin token: `ASKKING_RELAY_URL=<url> ASKKING_ADMIN_TOKEN=<token> npx askking@latest client`
- Start the local development relay from a repository checkout and show the first-run iOS pairing QR code: `pnpm dev`
- Run local automated verification: `pnpm smoke:local`

## Modes

- `off`: no AskKing behavior; hooks return without creating approval or completion events.
- `notify`: send approval/completion push notifications without persisting approval/completion records, and do not hand off approval or wait for continuation replies.
- `approval`: hand off approval decisions, and only notify completions.
- `full`: hand off approval decisions, notify completions, and wait for continuation replies.

## Rules

- Treat explicit mode changes as instructions to change mode, not as requests for explanation.
- Accept only `off`, `notify`, `approval`, and `full`.
- Prefer `npx askking@latest mode <mode>` because it uses the configured remote Relay when present and falls back to the local development Relay.
- Do not edit `~/.codex/hooks.json` for plugin installs; plugin hooks are supplied by the AskKing plugin and must be trusted through `/hooks`.
