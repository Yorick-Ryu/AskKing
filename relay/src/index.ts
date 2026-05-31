import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { publishBonjourRelay, type BonjourPublisher } from "./bonjour.js";

const config = loadConfig();
const store = new Store(config.databasePath);
const app = createApp(config, store);
let bonjourPublisher: BonjourPublisher | null = null;

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AskKing Relay listening on http://localhost:${info.port}`);
  if (!config.publicBaseUrl.includes("localhost")) {
    console.log(`AskKing Relay LAN URL: ${config.publicBaseUrl}`);
  }
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
