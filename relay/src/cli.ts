import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.databasePath);
const command = process.argv[2];

if (command === "pair") {
  const result = store.createPairingCode();
  console.log(`Pairing code: ${result.code}`);
  console.log(`Expires at: ${result.expiresAt}`);
} else if (command === "client") {
  const result = store.createClient(process.argv[3] ?? config.defaultClientName, process.argv[4] ?? "AskKing");
  console.log(`Client id: ${result.id}`);
  console.log(`Client token: ${result.token}`);
} else {
  console.error("Usage: tsx relay/src/cli.ts pair|client [name] [defaultProjectName]");
  process.exit(2);
}
