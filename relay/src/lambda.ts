import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DynamoStore } from "./dynamo-store.js";

const config = loadConfig();
const store = DynamoStore.fromEnv();
const app = createApp(config, store);

export const handler = handle(app);
