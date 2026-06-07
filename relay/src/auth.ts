import type { Context, Next } from "hono";
import type { RelayConfig } from "./config.js";
import type { RelayStore } from "./store.types.js";

export type AppEnv = {
  Variables: {
    clientId?: string;
    deviceId?: string;
    deviceSessionTokenHash?: string;
  };
};

function bearer(c: Context) {
  const value = c.req.header("authorization") ?? "";
  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function requireAdmin(config: RelayConfig) {
  return async (c: Context, next: Next) => {
    if (bearer(c) !== config.adminToken) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
}

export function requireClient(store: RelayStore) {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = bearer(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const client = await store.getClientByToken(token);
    if (!client) return c.json({ error: "unauthorized" }, 401);
    c.set("clientId", client.id);
    await next();
  };
}

export function requireDevice(store: RelayStore) {
  return async (c: Context<AppEnv>, next: Next) => {
    const token = bearer(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const device = await store.getDeviceByToken(token);
    if (!device) return c.json({ error: "unauthorized" }, 401);
    c.set("deviceId", device.id);
    c.set("clientId", device.clientId);
    c.set("deviceSessionTokenHash", device.sessionTokenHash);
    await next();
  };
}
