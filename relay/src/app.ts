import { Hono } from "hono";
import { cors } from "hono/cors";
import { redact } from "./crypto.js";
import { bearer, requireAdmin, requireClient, requireDevice, type AppEnv } from "./auth.js";
import type { RelayConfig } from "./config.js";
import { ApnsSender } from "./apns.js";
import type { RelayStore } from "./store.types.js";
import type { CompletionEvent } from "./types.js";

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function idParam(c: { req: { param: (name: string) => string | undefined } }) {
  const id = c.req.param("id");
  if (!id) throw new Error("missing route id");
  return id;
}

function requestTarget(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function runAfterResponse(c: { executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void } }, promise: Promise<unknown>) {
  try {
    const waitUntil = c.executionCtx?.waitUntil;
    if (waitUntil) {
      waitUntil.call(c.executionCtx, promise);
      return;
    }
  } catch {
    // Hono's Node adapter throws when ExecutionContext is unavailable.
  }
  void promise;
}

export function createApp(config: RelayConfig, store: RelayStore) {
  const app = new Hono<AppEnv>();
  const apns = new ApnsSender(config.apns);

  app.use("*", cors());
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    const startedAt = Date.now();
    try {
      await next();
      const durationMs = Date.now() - startedAt;
      const clientId = c.get("clientId");
      const deviceId = c.get("deviceId");
      console.info("[http]", requestId, c.req.method, requestTarget(c.req.url), c.res.status, `${durationMs}ms`, {
        clientId,
        deviceId
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      console.error("[http]", requestId, c.req.method, requestTarget(c.req.url), "error", `${durationMs}ms`, error);
      throw error;
    }
  });
  app.get("/health", (c) => c.json({ ok: true, mode: config.publicBaseUrl.startsWith("http://") ? "lan-dev" : "public", time: new Date().toISOString() }));

  app.post("/api/admin/pairing-code", requireAdmin(config), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await store.createPairingCode({ clientId: text(body.clientId) }));
  });

  app.post("/api/admin/clients", requireAdmin(config), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await store.createClient(text(body.name, config.defaultClientName), text(body.defaultProjectName, "Codex")));
  });

  app.post("/api/codex/pairing-code", requireClient(store), async (c) => {
    return c.json(await store.createPairingCode({ clientId: c.get("clientId")! }));
  });

  app.get("/api/admin/clients", requireAdmin(config), async (c) => {
    return c.json({ clients: await store.listClients() });
  });

  app.post("/api/admin/clients/:id/revoke", requireAdmin(config), async (c) => {
    const revoked = await store.revokeClient(idParam(c));
    if (!revoked) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/admin/devices", requireAdmin(config), async (c) => {
    return c.json({ devices: await store.listDevices() });
  });

  app.post("/api/admin/devices/:id/revoke", requireAdmin(config), async (c) => {
    const revoked = await store.revokeDevice(idParam(c));
    if (!revoked) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/devices/pair", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await store.pairDevice(text(body.code), text(body.name, "iPhone"));
    if (!result) return c.json({ error: "invalid_or_expired_pairing_code" }, 400);
    return c.json({ deviceId: result.id, sessionToken: result.sessionToken, relayBaseUrl: config.publicBaseUrl });
  });

  app.post("/api/devices/bootstrap", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await store.createDevice(text(body.name, "iPhone"));
    return c.json({ deviceId: result.id, sessionToken: result.sessionToken, clientToken: result.codexToken, relayBaseUrl: config.publicBaseUrl });
  });

  app.post("/api/mobile/codex-token", requireDevice(store), async (c) => {
    const token = await store.refreshDeviceCodexToken(c.get("deviceSessionTokenHash")!);
    return c.json({ clientToken: token, relayBaseUrl: config.publicBaseUrl });
  });

  app.put("/api/mobile/device-token", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const token = text(body.apnsToken);
    if (!token) return c.json({ error: "apnsToken_required" }, 400);
    await store.setDeviceApnsToken(c.get("deviceSessionTokenHash")!, token);
    return c.json({ ok: true });
  });

  app.delete("/api/mobile/device", requireDevice(store), async (c) => {
    const revoked = await store.revokeDevice(c.get("deviceId")!);
    if (!revoked) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/codex/completions", async (c) => {
    const token = bearer(c);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const client = await store.getClientByToken(token);
    const pushDevices = client
      ? await store.listPushDevices(client.id)
      : await store.listPushDevicesByCodexToken(token);
    if (!client && !pushDevices.length) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => ({}));
    if (client) c.set("clientId", client.id);
    const completion: CompletionEvent = {
      id: crypto.randomUUID(),
      clientId: client?.id ?? "",
      eventId: text(body.eventId, crypto.randomUUID()),
      projectName: text(body.projectName, "Codex"),
      cwd: text(body.cwd),
      model: text(body.model),
      sessionKey: text(body.sessionKey),
      summary: redact(text(body.summary, "Codex turn completed.")),
      status: "notified",
      expiresAt: "",
      notifyOnly: true,
      createdAt: new Date().toISOString(),
      reply: null,
      repliedAt: null
    };
    runAfterResponse(c, Promise.resolve(apns.sendCompletion(pushDevices, completion))
      .catch((error) => console.error("[apns] completion failed", error)));
    return c.json({ ok: true, id: completion.id });
  });

  return app;
}
