#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startRelay } from "./index.js";
import { Store } from "./store.js";

const command = process.argv[2];

function normalizeHookMode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "notify") return "notify";
  if (normalized === "approval") return "approval";
  if (normalized === "full") return "full";
  return null;
}

if (!command || command === "dev" || command === "start") {
  startRelay();
} else if (command === "pair") {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const result = store.createPairingCode();
  console.log(`Pairing code: ${result.code}`);
  console.log(`Expires at: ${result.expiresAt}`);
} else if (command === "client") {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const result = store.createClient(process.argv[3] ?? config.defaultClientName, process.argv[4] ?? "AskKing");
  console.log(`Client id: ${result.id}`);
  console.log(`Client token: ${result.token}`);
} else if (command === "mode") {
  const config = loadConfig();
  const store = new Store(config.databasePath);
  const requestedMode = process.argv[3];
  if (requestedMode) {
    if (requestedMode === "clear" || requestedMode === "default") {
      store.clearHookMode();
      console.log(`Hook mode: ${store.getHookMode() ?? "full"} (default)`);
      process.exit(0);
    }
    const mode = normalizeHookMode(requestedMode);
    if (!mode) {
      console.error("Mode must be one of: off, notify, approval, full");
      process.exit(2);
    }
    store.setHookMode(mode);
  }
  console.log(`Hook mode: ${store.getHookMode() ?? "full"}`);
} else {
  console.error("Usage: askking [dev|start|pair|client [name] [defaultProjectName]|mode [off|notify|approval|full|clear]]");
  process.exit(2);
}
