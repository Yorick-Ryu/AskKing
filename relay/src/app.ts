import { Hono } from "hono";
import { cors } from "hono/cors";
import { redact } from "./crypto.js";
import { commandSummary, riskSummary, sanitizeCommand } from "./security.js";
import { requireAdmin, requireClient, requireDevice, type AppEnv } from "./auth.js";
import type { RelayConfig } from "./config.js";
import { ApnsSender } from "./apns.js";
import type { RelayStore } from "./store.types.js";
import type { ApprovalRequest, CompletionEvent, HookMode } from "./types.js";

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

function requestTarget(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function hookMode(value: unknown): HookMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "notify") return "notify";
  if (normalized === "approval") return "approval";
  if (normalized === "full") return "full";
  return null;
}

function terminalApproval(status: string) {
  return status === "allowed" || status === "denied" || status === "expired";
}

function terminalCompletion(status: string) {
  return status === "replied" || status === "interrupted" || status === "expired";
}

async function hookModeResponse(store: RelayStore, clientId: string) {
  const mode = await store.getHookMode(clientId);
  return { mode: mode ?? "notify", configured: mode !== null };
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
    return c.json(await store.createClient(text(body.name, config.defaultClientName), text(body.defaultProjectName, "AskKing")));
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

  app.get("/api/mobile/events", requireDevice(store), async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    return c.json({ events: await store.listEvents(c.get("clientId")!, Math.min(Math.max(limit, 1), 100)) });
  });

  app.get("/api/mobile/hook-mode", requireDevice(store), async (c) => {
    return c.json(await hookModeResponse(store, c.get("clientId")!));
  });

  app.post("/api/mobile/hook-mode", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const mode = hookMode(body.mode);
    if (!mode) return c.json({ error: "mode_must_be_off_notify_approval_or_full" }, 400);
    return c.json({ mode: await store.setHookMode(c.get("clientId")!, mode) });
  });

  app.delete("/api/mobile/hook-mode", requireDevice(store), async (c) => {
    await store.clearHookMode(c.get("clientId")!);
    return c.json(await hookModeResponse(store, c.get("clientId")!));
  });

  app.get("/api/mobile/approvals/:id", requireDevice(store), async (c) => {
    const approval = await store.getApproval(idParam(c), c.get("clientId")!);
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.post("/api/mobile/approvals/:id/decision", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const decision = body.decision === "allow" || body.decision === "allowed" ? "allowed" : body.decision === "deny" || body.decision === "denied" ? "denied" : null;
    if (!decision) return c.json({ error: "decision_must_be_allow_or_deny" }, 400);
    const current = await store.getApproval(idParam(c), c.get("clientId")!);
    if (current?.notifyOnly) return c.json({ error: "approval_is_notify_only" }, 409);
    const approval = await store.decideApproval(idParam(c), c.get("clientId")!, decision, `ios:${c.get("deviceId")}`);
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.get("/api/mobile/completions/:id", requireDevice(store), async (c) => {
    const completion = await store.getCompletion(idParam(c), c.get("clientId")!);
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  app.post("/api/mobile/completions/:id/reply", requireDevice(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const reply = text(body.reply);
    if (!reply) return c.json({ error: "reply_required" }, 400);
    const current = await store.getCompletion(idParam(c), c.get("clientId")!);
    if (current?.notifyOnly) return c.json({ error: "completion_is_notify_only" }, 409);
    const completion = await store.replyCompletion(idParam(c), c.get("clientId")!, reply);
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  app.post("/api/codex/approvals", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const commandFull = sanitizeCommand(text(body.commandFull ?? body.command ?? body.commandSummary, "Codex command"));
    const rawSummary = text(body.commandSummary, commandFull);
    const notifyOnly = body.notifyOnly === true;
    const approvalInput = {
      clientId: c.get("clientId")!,
      eventId: text(body.eventId, crypto.randomUUID()),
      projectName: text(body.projectName, "AskKing"),
      cwd: text(body.cwd),
      model: text(body.model),
      commandSummary: commandSummary(rawSummary),
      commandFull,
      reason: text(body.reason, "Codex requested permission."),
      riskSummary: riskSummary(commandFull, text(body.riskSummary)),
      expiresAt: expiresIn(Number(body.ttlSeconds ?? 600)),
      notifyOnly
    };
    const approval = await store.createApproval(approvalInput);
    runAfterResponse(c, Promise.resolve(store.listPushDevices(c.get("clientId")!))
      .then((devices) => apns.sendApproval(devices, approval, { actionable: !notifyOnly }))
      .catch((error) => console.error("[apns] approval failed", error)));
    return c.json({ approval });
  });

  app.get("/api/codex/hook-mode", requireClient(store), async (c) => {
    return c.json(await hookModeResponse(store, c.get("clientId")!));
  });

  app.post("/api/codex/hook-mode", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const mode = hookMode(body.mode);
    if (!mode) return c.json({ error: "mode_must_be_off_notify_approval_or_full" }, 400);
    return c.json({ mode: await store.setHookMode(c.get("clientId")!, mode) });
  });

  app.delete("/api/codex/hook-mode", requireClient(store), async (c) => {
    await store.clearHookMode(c.get("clientId")!);
    return c.json(await hookModeResponse(store, c.get("clientId")!));
  });

  app.get("/api/codex/approvals/:id", requireClient(store), async (c) => {
    const approval = await store.getApproval(idParam(c), c.get("clientId")!);
    if (!approval) return c.json({ error: "not_found" }, 404);
    return c.json({ approval });
  });

  app.get("/api/codex/approvals/:id/wait", requireClient(store), async (c) => {
    const deadline = Date.now() + Math.min(Number(c.req.query("timeoutMs") ?? "30000"), 60000);
    const approvalId = idParam(c);
    let approval = await store.getApproval(approvalId, c.get("clientId")!);
    while (approval?.status === "pending" && Date.now() < deadline) {
      await sleep(1000);
      await store.expireApproval(approvalId, c.get("clientId")!);
      approval = await store.getApproval(approvalId, c.get("clientId")!);
    }
    if (!approval) return c.json({ error: "not_found" }, 404);
    if (terminalApproval(approval.status)) {
      const consumed = await store.consumeTerminalApproval(approval.id, c.get("clientId")!);
      if (!consumed) return c.json({ error: "not_found" }, 404);
      approval = consumed;
    }
    return c.json({ approval });
  });

  app.post("/api/codex/completions", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const hasReplyDevice = await store.hasEnabledDevice(c.get("clientId")!);
    const pushDevices = await store.listPushDevices(c.get("clientId")!);
    const notifyOnly = body.notifyOnly === true;
    const waitForReply = !notifyOnly && body.waitForReply !== false && hasReplyDevice;
    const completionInput: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt"> = {
      clientId: c.get("clientId")!,
      eventId: text(body.eventId, crypto.randomUUID()),
      projectName: text(body.projectName, "AskKing"),
      cwd: text(body.cwd),
      model: text(body.model),
      sessionKey: text(body.sessionKey),
      summary: redact(text(body.summary, "Codex turn completed.")),
      status: waitForReply ? "waiting" : "notified",
      expiresAt: expiresIn(Number(body.ttlSeconds ?? 45)),
      notifyOnly
    };
    const completion = await store.createCompletion(completionInput);
    runAfterResponse(c, Promise.resolve(apns.sendCompletion(pushDevices, completion, { actionable: !notifyOnly }))
      .catch((error) => console.error("[apns] completion failed", error)));
    return c.json({ completion });
  });

  app.post("/api/codex/completions/:id/interrupt", requireClient(store), async (c) => {
    const completion = await store.interruptCompletion(idParam(c), c.get("clientId")!);
    if (!completion) return c.json({ error: "not_found" }, 404);
    return c.json({ completion });
  });

  app.post("/api/codex/completions/local-prompt", requireClient(store), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const prompt = text(body.prompt);
    if (!prompt) return c.json({ error: "prompt_required" }, 400);
    const completion = await store.continueLatestCompletionLocally({
      clientId: c.get("clientId")!,
      cwd: text(body.cwd),
      projectName: text(body.projectName, "AskKing"),
      sessionKey: text(body.sessionKey),
      prompt: redact(prompt)
    });
    return c.json({ completion });
  });

  app.get("/api/codex/completions/:id/wait", requireClient(store), async (c) => {
    const deadline = Date.now() + Math.min(Number(c.req.query("timeoutMs") ?? "45000"), 60000);
    const completionId = idParam(c);
    let completion = await store.getCompletion(completionId, c.get("clientId")!);
    while (completion?.status === "waiting" && Date.now() < deadline) {
      await sleep(1000);
      await store.expireCompletion(completionId, c.get("clientId")!);
      completion = await store.getCompletion(completionId, c.get("clientId")!);
    }
    if (!completion) return c.json({ error: "not_found" }, 404);
    if (terminalCompletion(completion.status)) {
      const consumed = await store.consumeTerminalCompletion(completion.id, c.get("clientId")!);
      if (!consumed) return c.json({ error: "not_found" }, 404);
      completion = consumed;
    }
    return c.json({ completion });
  });

  return app;
}
