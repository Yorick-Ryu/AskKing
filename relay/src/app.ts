import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { redact } from "./crypto.js";
import { commandSummary, riskSummary, sanitizeCommand } from "./security.js";
import { requireAdmin, requireClient, requireDevice, type AppEnv } from "./auth.js";
import type { RelayConfig } from "./config.js";
import { ApnsSender } from "./apns.js";
import type { RelayStore } from "./store.types.js";

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function expiresIn(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idParam(c: { req: { param: (name: string) => string | undefined } }) {
  const id = c.req.param("id");
  if (!id) throw new Error("missing route id");
  return id;
}

export function createApp(config: RelayConfig, store: RelayStore) {
  const app = new Hono<AppEnv>();
  const apns = new ApnsSender(config.apns);

  app.use("*", cors());
  app.use("*", async (_c, next) => {
    await store.expireOld();
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, mode: config.publicBaseUrl.startsWith("http://") ? "lan-dev" : "public", time: new Date().toISOString() }));

  app.post("/api/admin/pairing-code", requireAdmin(config), async (c) => {
    return c.json(await store.createPairingCode());
  });

  app.post("/api/admin/clients", requireAdmin(config), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await store.createClient(text(body.name, config.defaultClientName), text(body.defaultProjectName, "AskKing")));
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

  app.put("/api/mobile/device-token", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const token = text(body.apnsToken);
    if (!token) return c.json({ error: "apnsToken_required" }, 400);
    await store.setDeviceApnsToken(c.get("deviceId")!, token);
    return c.json({ ok: true });
  });

  app.get("/api/mobile/events", requireDevice(store), async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    return c.json({ events: await store.listEvents(Math.min(Math.max(limit, 1), 100)) });
  });

  app.get("/api/mobile/approvals/:id", requireDevice(store), async (c) => {
    const approval = await store.getApproval(idParam(c));
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.post("/api/mobile/approvals/:id/decision", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const decision = body.decision === "allow" || body.decision === "allowed" ? "allowed" : body.decision === "deny" || body.decision === "denied" ? "denied" : null;
    if (!decision) return c.json({ error: "decision_must_be_allow_or_deny" }, 400);
    const approval = await store.decideApproval(idParam(c), decision, `ios:${c.get("deviceId")}`);
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.get("/api/mobile/completions/:id", requireDevice(store), async (c) => {
    const completion = await store.getCompletion(idParam(c));
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  app.post("/api/mobile/completions/:id/reply", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const reply = text(body.reply);
    if (!reply) return c.json({ error: "reply_required" }, 400);
    const completion = await store.replyCompletion(idParam(c), reply);
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  app.post("/api/codex/approvals", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const commandFull = sanitizeCommand(text(body.commandFull ?? body.command ?? body.commandSummary, "Codex command"));
    const rawSummary = text(body.commandSummary, commandFull);
    const approval = await store.createApproval({
      clientId: c.get("clientId")!,
      eventId: text(body.eventId, randomUUID()),
      projectName: text(body.projectName, "AskKing"),
      cwd: text(body.cwd),
      model: text(body.model),
      commandSummary: commandSummary(rawSummary),
      commandFull,
      reason: text(body.reason, "Codex requested permission."),
      riskSummary: riskSummary(commandFull, text(body.riskSummary, "Review before allowing.")),
      expiresAt: expiresIn(Number(body.ttlSeconds ?? 600))
    });
    Promise.resolve(store.listPushDevices())
      .then((devices) => apns.sendApproval(devices, approval))
      .catch((error) => console.error("[apns] approval failed", error));
    return c.json({ approval });
  });

  app.get("/api/codex/approvals/:id", requireClient(store), async (c) => {
    const approval = await store.getApproval(idParam(c));
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.get("/api/codex/approvals/:id/wait", requireClient(store), async (c) => {
    const deadline = Date.now() + Math.min(Number(c.req.query("timeoutMs") ?? "30000"), 60000);
    const approvalId = idParam(c);
    let approval = await store.getApproval(approvalId);
    while (approval?.status === "pending" && Date.now() < deadline) {
      await sleep(1000);
      await store.expireOld();
      approval = await store.getApproval(approvalId);
    }
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.post("/api/codex/completions", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const completion = await store.createCompletion({
      clientId: c.get("clientId")!,
      eventId: text(body.eventId, randomUUID()),
      projectName: text(body.projectName, "AskKing"),
      cwd: text(body.cwd),
      model: text(body.model),
      summary: redact(text(body.summary, "Codex turn completed.")),
      expiresAt: expiresIn(Number(body.ttlSeconds ?? 45))
    });
    Promise.resolve(store.listPushDevices())
      .then((devices) => apns.sendCompletion(devices, completion))
      .catch((error) => console.error("[apns] completion failed", error));
    return c.json({ completion });
  });

  app.get("/api/codex/completions/:id/wait", requireClient(store), async (c) => {
    const deadline = Date.now() + Math.min(Number(c.req.query("timeoutMs") ?? "45000"), 60000);
    const completionId = idParam(c);
    let completion = await store.getCompletion(completionId);
    while (completion?.status === "waiting_reply" && Date.now() < deadline) {
      await sleep(1000);
      await store.expireOld();
      completion = await store.getCompletion(completionId);
    }
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  return app;
}
