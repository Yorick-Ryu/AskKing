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

- Start the local relay and show the first-run iOS pairing QR code: `npx askking@latest`
- Create a fresh iOS pairing code manually: `npx askking@latest pair`
- Run local automated verification: `pnpm smoke:local`

## Modes

- `off`: no AskKing behavior; hooks return without creating approval or completion events.
- `notify`: notify approval requests and completions, but do not hand off approval or wait for continuation replies.
- `approval`: hand off approval decisions, and only notify completions.
- `full`: hand off approval decisions, notify completions, and wait for continuation replies.

## Rules

- Treat explicit mode changes as instructions to change mode, not as requests for explanation.
- Accept only `off`, `notify`, `approval`, and `full`.
- Prefer `npx askking@latest mode <mode>` because hooks can read explicit relay mode while running.
- Do not edit `~/.codex/hooks.json` for plugin installs; plugin hooks are supplied by the AskKing plugin and must be trusted through `/hooks`.
