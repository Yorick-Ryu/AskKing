const baseUrl = (process.env.ASKKING_SMOKE_BASE_URL || process.argv[2] || "").replace(/\/+$/, "");
const adminToken = process.env.ASKKING_ADMIN_TOKEN || process.argv[3] || "";

if (!baseUrl || !adminToken) {
  console.error("Usage: ASKKING_SMOKE_BASE_URL=<url> ASKKING_ADMIN_TOKEN=<token> node scripts/smoke-remote.mjs");
  process.exit(2);
}

const stamp = Date.now().toString(36);

const health = await requestJson(`${baseUrl}/health`);
assert(health.ok === true, "health endpoint is ok");

const client = await requestJson(`${baseUrl}/api/admin/clients`, {
  method: "POST",
  headers: authHeaders(adminToken),
  body: JSON.stringify({ name: `Smoke Codex ${stamp}`, defaultProjectName: "Smoke" })
});
assert(String(client.token ?? "").startsWith("ck_"), "admin can create Codex client");

const clientToken = String(client.token);
const pairing = await requestJson(`${baseUrl}/api/codex/pairing-code`, {
  method: "POST",
  headers: authHeaders(clientToken)
});
assert(typeof pairing.code === "string" && pairing.code.includes("-"), "Codex client can create pairing code");

const paired = await requestJson(`${baseUrl}/api/devices/pair`, {
  method: "POST",
  headers: jsonHeaders(),
  body: JSON.stringify({ code: pairing.code, name: `Smoke iPhone ${stamp}` })
});
assert(String(paired.sessionToken ?? "").startsWith("ios_"), "device can pair");
assert(paired.relayBaseUrl === baseUrl || typeof paired.relayBaseUrl === "string", "pair response includes relay base URL");

const sessionToken = String(paired.sessionToken);
const defaultHookMode = await requestJson(`${baseUrl}/api/mobile/hook-mode`, {
  headers: authHeaders(sessionToken)
});
assert(defaultHookMode.mode === "notify", "hook mode defaults to notify");

const setHookMode = await requestJson(`${baseUrl}/api/codex/hook-mode`, {
  method: "POST",
  headers: authHeaders(clientToken),
  body: JSON.stringify({ mode: "full" })
});
assert(setHookMode.mode === "full", "Codex can set hook mode");

const approval = await requestJson(`${baseUrl}/api/codex/approvals`, {
  method: "POST",
  headers: authHeaders(clientToken),
  body: JSON.stringify({
    projectName: "Smoke",
    commandSummary: "echo cloudflare d1 smoke",
    commandFull: "echo cloudflare d1 smoke",
    ttlSeconds: 60
  })
});
assert(approval.approval.status === "pending", "approval starts pending");

const events = await requestJson(`${baseUrl}/api/mobile/events`, {
  headers: authHeaders(sessionToken)
});
assert(events.events.some((event) => event.kind === "approval" && event.id === approval.approval.id), "mobile sees approval event");

const decided = await requestJson(`${baseUrl}/api/mobile/approvals/${approval.approval.id}/decision`, {
  method: "POST",
  headers: authHeaders(sessionToken),
  body: JSON.stringify({ decision: "allow" })
});
assert(decided.approval.status === "allowed", "mobile can allow approval");

const approvalWait = await requestJson(`${baseUrl}/api/codex/approvals/${approval.approval.id}/wait?timeoutMs=1000`, {
  headers: authHeaders(clientToken)
});
assert(approvalWait.approval.status === "allowed", "Codex sees allowed approval");

const completion = await requestJson(`${baseUrl}/api/codex/completions`, {
  method: "POST",
  headers: authHeaders(clientToken),
  body: JSON.stringify({
    projectName: "Smoke",
    cwd: "/tmp/askking-smoke",
    sessionKey: `smoke-${stamp}`,
    summary: "Cloudflare D1 smoke completion.",
    ttlSeconds: 60
  })
});
assert(completion.completion.status === "waiting", "completion waits for reply when a device is paired");

const replied = await requestJson(`${baseUrl}/api/mobile/completions/${completion.completion.id}/reply`, {
  method: "POST",
  headers: authHeaders(sessionToken),
  body: JSON.stringify({ reply: "continue from smoke" })
});
assert(replied.completion.status === "replied", "mobile can reply to completion");

const completionWait = await requestJson(`${baseUrl}/api/codex/completions/${completion.completion.id}/wait?timeoutMs=1000`, {
  headers: authHeaders(clientToken)
});
assert(completionWait.completion.reply === "continue from smoke", "Codex receives completion reply");

await requestJson(`${baseUrl}/api/mobile/device`, {
  method: "DELETE",
  headers: authHeaders(sessionToken)
});
await requestJson(`${baseUrl}/api/admin/clients/${client.id}/revoke`, {
  method: "POST",
  headers: authHeaders(adminToken)
});

console.log(`Remote smoke passed: ${baseUrl}`);

function jsonHeaders() {
  return { "content-type": "application/json" };
}

function authHeaders(token) {
  return { ...jsonHeaders(), authorization: `Bearer ${token}` };
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? jsonHeaders() : {}),
      ...(init.headers ?? {})
    }
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`ok - ${message}`);
}
