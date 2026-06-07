import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { publishBonjourRelay, type BonjourPublisher } from "./bonjour.js";
import { printPairingQr } from "./pairing-qr.js";

function askKingCodexConfigPath() {
  const home = process.env.HOME;
  return home ? join(home, ".codex", "askking", "config.json") : null;
}

function loadExistingClientToken(path: string) {
  if (!existsSync(path)) return "";
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return typeof payload.clientToken === "string" ? payload.clientToken : "";
  } catch {
    return "";
  }
}

function ensureLocalCodexClientConfig(config: ReturnType<typeof loadConfig>, store: Store) {
  if (process.env.ASKKING_WRITE_CODEX_CONFIG === "0") return;

  const path = askKingCodexConfigPath();
  if (!path) return;

  const existingToken = loadExistingClientToken(path);
  if (existingToken && store.getClientByToken(existingToken)) {
    console.log(`Codex Done config: ${path}`);
    return;
  }

  const client = store.createClient(config.defaultClientName, "Codex");
  const payload = {
    relayUrl: "http://localhost:" + config.port,
    clientToken: client.token
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Codex Done client: ${client.id}`);
  console.log(`Codex Done config: ${path}`);
}

function printNewPairingQr(config: ReturnType<typeof loadConfig>, store: Store) {
  const pairing = store.createPairingCode();
  printPairingQr({
    relayUrl: config.publicBaseUrl,
    code: pairing.code,
    expiresAt: pairing.expiresAt
  });
}

function scheduleStartupPairingQr(config: ReturnType<typeof loadConfig>, store: Store) {
  if (process.env.ASKKING_PAIR_ON_START === "0") return;
  printNewPairingQr(config, store);
}

export function startRelay() {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const app = createApp(config, store);
  let bonjourPublisher: BonjourPublisher | null = null;

  ensureLocalCodexClientConfig(config, store);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Codex Done Relay listening on http://localhost:${info.port}`);
    if (!config.publicBaseUrl.includes("localhost")) {
      console.log(`Codex Done Relay LAN URL: ${config.publicBaseUrl}`);
    }
    scheduleStartupPairingQr(config, store);
    void publishBonjourRelay(config).then((publisher) => {
      bonjourPublisher = publisher;
    });
  });

  async function shutdownAndExit(code: number) {
    await bonjourPublisher?.shutdown().catch((error) => {
      console.warn("[bonjour] shutdown failed", error);
    });

    const forceExit = setTimeout(() => process.exit(code), 1000);
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(code);
    });
  }

  process.once("SIGINT", () => {
    void shutdownAndExit(130);
  });
  process.once("SIGTERM", () => {
    void shutdownAndExit(143);
  });

  return server;
}

if (require.main === module) {
  startRelay();
}
