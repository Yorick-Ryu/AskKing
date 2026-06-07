import { createApp } from "./app.js";
import { D1Store, type D1Database } from "./d1-store.js";
import type { RelayConfig } from "./config.js";

type WorkerEnv = {
  ASKKING_D1: D1Database;
  ASKKING_PUBLIC_BASE_URL?: string;
  ASKKING_ADMIN_TOKEN?: string;
  ASKKING_CLIENT_NAME?: string;
  ASKKING_APNS_ENABLED?: string;
  ASKKING_APNS_KEY_ID?: string;
  ASKKING_APNS_TEAM_ID?: string;
  ASKKING_APNS_TOPIC?: string;
  ASKKING_APNS_KEY?: string;
  ASKKING_APNS_PRODUCTION?: string;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
};

function envValue(env: WorkerEnv, key: keyof WorkerEnv, fallback = "") {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function loadWorkerConfig(env: WorkerEnv): RelayConfig {
  return {
    port: 0,
    databasePath: "",
    publicBaseUrl: envValue(env, "ASKKING_PUBLIC_BASE_URL"),
    bonjourEnabled: false,
    bonjourName: "AskKing Relay",
    adminToken: envValue(env, "ASKKING_ADMIN_TOKEN", "dev-admin-token"),
    defaultClientName: envValue(env, "ASKKING_CLIENT_NAME", "Cloudflare Codex"),
    apns: {
      enabled: envValue(env, "ASKKING_APNS_ENABLED") === "1",
      keyId: envValue(env, "ASKKING_APNS_KEY_ID"),
      teamId: envValue(env, "ASKKING_APNS_TEAM_ID"),
      topic: envValue(env, "ASKKING_APNS_TOPIC"),
      keyPath: "",
      keyText: envValue(env, "ASKKING_APNS_KEY"),
      production: envValue(env, "ASKKING_APNS_PRODUCTION") === "1"
    }
  };
}

export default {
  fetch(request: Request, env: WorkerEnv, executionCtx: WorkerExecutionContext) {
    const config = loadWorkerConfig(env);
    const store = new D1Store(env.ASKKING_D1);
    const app = createApp(config, store);
    return app.fetch(request, env, executionCtx as never);
  }
};
