---
name: askking
description: "Use when the user asks to install or configure Codex Done, pair the iOS app, generate Codex hook client tokens, or start the Codex Done Relay."
---

# Codex Done

## Flow Commands

- Configure hooks for a remote Relay: `npx askking@latest configure <relayUrl> <clientToken>`
- The iOS app now creates the `<clientToken>` automatically. Copy the setup prompt from the iOS app and run the command it provides.
- Start the local development relay from a repository checkout and show the first-run iOS pairing QR code: `pnpm dev`

## Behavior

Codex Done only installs a Codex `Stop` hook. The hook sends a completion notification to the iOS device selected by the configured token, then immediately returns control to Codex.

## Rules

- Do not configure approval, continuation reply, or hook mode behavior.
- Do not edit `~/.codex/hooks.json` for plugin installs; plugin hooks are supplied by the plugin and must be trusted through `/hooks`.
