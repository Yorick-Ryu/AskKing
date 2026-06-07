#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const command = process.argv[2];

function askKingCodexConfigPath() {
  const home = process.env.HOME;
  return home ? join(home, ".codex", "askking", "config.json") : null;
}

function readCodexConfig() {
  const path = askKingCodexConfigPath();
  if (!path || !existsSync(path)) return {};
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return typeof payload === "object" && payload ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function configuredRelay() {
  const payload = readCodexConfig();
  const relayUrl = (process.env.ASKKING_RELAY_URL || String(payload.relayUrl ?? "")).trim().replace(/\/+$/, "");
  const clientToken = (process.env.ASKKING_CLIENT_TOKEN || String(payload.clientToken ?? "")).trim();
  return relayUrl && clientToken ? { relayUrl, clientToken } : null;
}

function writeCodexConfig(relayUrl: string, clientToken: string) {
  const path = askKingCodexConfigPath();
  if (!path) throw new Error("HOME is required to write Codex Done config");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ relayUrl: relayUrl.replace(/\/+$/, ""), clientToken }, null, 2) + "\n");
  return path;
}

async function requestJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return payload as Record<string, unknown>;
}

async function localStore() {
  try {
    const [{ loadConfig }, { Store }] = await Promise.all([
      import("./config.js"),
      import("./store.js")
    ]);
    const config = loadConfig();
    return { config, store: new Store(config.databasePath) };
  } catch (error) {
    throw localDevelopmentError(error);
  }
}

function localDevelopmentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error([
    "This command needs the local development Relay dependencies.",
    "For the remote-only path, run `askking configure <relayUrl> <clientToken>` first, then retry the command.",
    "For local development, install dev dependencies in the repository with `pnpm install`.",
    `Original error: ${message}`
  ].join("\n"));
}

async function main() {
  if (!command || command === "dev" || command === "start") {
    try {
      const { startRelay } = await import("./index.js");
      startRelay();
    } catch (error) {
      throw localDevelopmentError(error);
    }
  } else if (command === "configure") {
    const relayUrl = process.argv[3];
    const clientToken = process.argv[4];
    if (!relayUrl || !clientToken) {
      console.error("Usage: askking configure <relayUrl> <clientToken>");
      process.exit(2);
    }
    const path = writeCodexConfig(relayUrl, clientToken);
    console.log(`Codex Done config: ${path}`);
  } else if (command === "pair") {
    const remote = configuredRelay();
    if (remote) {
      const result = await requestJson(`${remote.relayUrl}/api/codex/pairing-code`, remote.clientToken, { method: "POST" });
      console.log(`Pairing code: ${result.code}`);
      console.log(`Expires at: ${result.expiresAt}`);
      return;
    }
    const { store } = await localStore();
    const result = store.createPairingCode();
    console.log(`Pairing code: ${result.code}`);
    console.log(`Expires at: ${result.expiresAt}`);
  } else if (command === "client") {
    const relayUrl = process.env.ASKKING_RELAY_URL || process.argv[3];
    const adminToken = process.env.ASKKING_ADMIN_TOKEN || process.argv[4];
    if (relayUrl?.startsWith("http") && adminToken) {
      const result = await requestJson(`${relayUrl.replace(/\/+$/, "")}/api/admin/clients`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          name: process.argv[5] ?? "Remote Codex",
          defaultProjectName: process.argv[6] ?? "Codex"
        })
      });
      console.log(`Client id: ${result.id}`);
      console.log(`Client token: ${result.token}`);
      return;
    }
    const { config, store } = await localStore();
    const result = store.createClient(process.argv[3] ?? config.defaultClientName, process.argv[4] ?? "Codex");
    console.log(`Client id: ${result.id}`);
    console.log(`Client token: ${result.token}`);
  } else {
    console.error("Usage: askking [dev|start|configure <relayUrl> <clientToken>|pair|client [relayUrl adminToken [name] [defaultProjectName]]]");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
