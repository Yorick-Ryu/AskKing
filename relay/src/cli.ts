import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.databasePath);
const command = process.argv[2];

function normalizeHookMode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "off" || normalized === "none" || normalized === "disabled") return "off";
  if (normalized === "1" || normalized === "2" || normalized === "notify" || normalized === "notify_only") return "notify";
  if (normalized === "3" || normalized === "approval" || normalized === "approval_only" || normalized === "permission") return "approval";
  if (normalized === "4" || normalized === "full" || normalized === "wait" || normalized === "all") return "full";
  return null;
}

if (command === "pair") {
  const result = store.createPairingCode();
  console.log(`Pairing code: ${result.code}`);
  console.log(`Expires at: ${result.expiresAt}`);
} else if (command === "client") {
  const result = store.createClient(process.argv[3] ?? config.defaultClientName, process.argv[4] ?? "AskKing");
  console.log(`Client id: ${result.id}`);
  console.log(`Client token: ${result.token}`);
} else if (command === "mode") {
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
  console.error("Usage: tsx relay/src/cli.ts pair|client [name] [defaultProjectName]|mode [off|notify|approval|full|clear]");
  process.exit(2);
}
