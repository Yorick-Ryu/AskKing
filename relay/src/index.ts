import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.databasePath);
const app = createApp(config, store);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AskKing Relay listening on http://localhost:${info.port}`);
  if (!config.publicBaseUrl.includes("localhost")) {
    console.log(`AskKing Relay LAN URL: ${config.publicBaseUrl}`);
  }
});
