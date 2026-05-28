import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 8810 + Math.floor(Math.random() * 500);
const baseUrl = `http://localhost:${port}`;
const workDir = await mkdtemp(join(tmpdir(), "askking-smoke-"));
const dbPath = join(workDir, "askking.sqlite");
const adminToken = "dev-admin-token";

let server;

try {
  const clientOutput = await run("node", ["dist/cli.js", "client", "SmokeClient", "SmokeProject"], {
    ASKKING_DB: dbPath
  });
  const clientToken = match(clientOutput, /Client token: (.+)/);

  server = spawn("node", ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ASKKING_DB: dbPath,
      ASKKING_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(server, baseUrl);

  const unauthorized = await request(`${baseUrl}/api/codex/approvals/test`, {
    headers: { authorization: "Bearer wrong" }
  }, false);
  assert(unauthorized.status === 401, "wrong Codex token is rejected");

  const approval = await requestJson(`${baseUrl}/api/codex/approvals`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      commandSummary: "echo hello",
      ttlSeconds: 60
    })
  });
  assert(approval.approval.status === "pending", "approval starts pending");
  assert(approval.approval.riskSummary === "", "normal approval has no fallback risk summary");

  const pairing = await requestJson(`${baseUrl}/api/admin/pairing-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const paired = await requestJson(`${baseUrl}/api/devices/pair`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      code: pairing.code,
      name: "Smoke iPhone"
    })
  });
  assert(paired.sessionToken.startsWith("ios_"), "device receives iOS session token");

  const decided = await requestJson(`${baseUrl}/api/mobile/approvals/${approval.approval.id}/decision`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ decision: "allow" })
  });
  assert(decided.approval.status === "allowed", "iOS approval decision is accepted");

  const approvalWait = await requestJson(`${baseUrl}/api/codex/approvals/${approval.approval.id}/wait?timeoutMs=1000`, {
    headers: { authorization: `Bearer ${clientToken}` }
  });
  assert(approvalWait.approval.status === "allowed", "Codex wait sees allowed decision");

  const repeatedDecision = await requestJson(`${baseUrl}/api/mobile/approvals/${approval.approval.id}/decision`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ decision: "deny" })
  });
  assert(repeatedDecision.approval.status === "allowed", "repeated approval decision keeps first decision");

  const sensitiveApproval = await requestJson(`${baseUrl}/api/codex/approvals`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      commandSummary: `sudo rm -rf /tmp/askking-smoke api_key=super-secret-token ${"x".repeat(260)}`,
      commandFull: "sudo rm -rf /tmp/askking-smoke api_key=super-secret-token",
      ttlSeconds: 60
    })
  });
  assert(!sensitiveApproval.approval.commandSummary.includes("super-secret-token"), "approval summary redacts sensitive values");
  assert(!sensitiveApproval.approval.commandFull.includes("super-secret-token"), "approval command redacts sensitive values");
  assert(sensitiveApproval.approval.commandSummary.length <= 180, "approval summary is truncated for notification safety");
  assert(sensitiveApproval.approval.riskSummary.includes("High risk"), "high risk command is marked");

  const extraClient = await requestJson(`${baseUrl}/api/admin/clients`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({ name: "Revoked Codex", defaultProjectName: "Smoke" })
  });
  const clients = await requestJson(`${baseUrl}/api/admin/clients`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(clients.clients.some((client) => client.id === extraClient.id), "admin can list Codex clients");
  await requestJson(`${baseUrl}/api/admin/clients/${extraClient.id}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const revokedClientResponse = await request(`${baseUrl}/api/codex/approvals/test`, {
    headers: { authorization: `Bearer ${extraClient.token}` }
  }, false);
  assert(revokedClientResponse.status === 401, "revoked Codex client token is rejected");

  const extraPairing = await requestJson(`${baseUrl}/api/admin/pairing-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const extraDevice = await requestJson(`${baseUrl}/api/devices/pair`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      code: extraPairing.code,
      name: "Revoked iPhone"
    })
  });
  const devices = await requestJson(`${baseUrl}/api/admin/devices`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(devices.devices.some((device) => device.id === extraDevice.deviceId), "admin can list iOS devices");
  await requestJson(`${baseUrl}/api/admin/devices/${extraDevice.deviceId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const revokedDeviceResponse = await request(`${baseUrl}/api/mobile/events`, {
    headers: { authorization: `Bearer ${extraDevice.sessionToken}` }
  }, false);
  assert(revokedDeviceResponse.status === 401, "revoked iOS session token is rejected");

  const completion = await requestJson(`${baseUrl}/api/codex/completions`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      summary: "Codex turn completed.",
      ttlSeconds: 60
    })
  });
  assert(completion.completion.status === "waiting", "completion starts waiting for reply");

  const replied = await requestJson(`${baseUrl}/api/mobile/completions/${completion.completion.id}/reply`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ reply: "continue with smoke test" })
  });
  assert(replied.completion.status === "replied", "iOS completion reply is accepted");

  const completionWait = await requestJson(`${baseUrl}/api/codex/completions/${completion.completion.id}/wait?timeoutMs=1000`, {
    headers: { authorization: `Bearer ${clientToken}` }
  });
  assert(completionWait.completion.status === "replied", "Codex wait sees completion reply");
  assert(completionWait.completion.reply === "continue with smoke test", "Codex wait receives continuation text");

  const notifiedCompletion = await requestJson(`${baseUrl}/api/codex/completions`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      cwd: process.cwd(),
      sessionKey: "smoke-local-session",
      summary: "Codex turn notify only.",
      waitForReply: false,
      ttlSeconds: 60
    })
  });
  assert(notifiedCompletion.completion.status === "notified", "notify-only completion starts notified");

  const localPrompt = await requestJson(`${baseUrl}/api/codex/completions/local-prompt`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      cwd: process.cwd(),
      sessionKey: "smoke-local-session",
      prompt: "continue locally from Mac"
    })
  });
  assert(localPrompt.completion.status === "replied", "local prompt marks latest completion replied");
  assert(localPrompt.completion.reply === "continue locally from Mac", "local prompt text is stored for iOS state sync");

  const interruptibleCompletion = await requestJson(`${baseUrl}/api/codex/completions`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      cwd: process.cwd(),
      summary: "Codex turn interrupted.",
      ttlSeconds: 60
    })
  });
  const interruptedCompletion = await requestJson(`${baseUrl}/api/codex/completions/${interruptibleCompletion.completion.id}/interrupt`, {
    method: "POST",
    headers: authHeaders(clientToken)
  });
  assert(interruptedCompletion.completion.status === "interrupted", "Codex can mark a waiting completion interrupted");

  const permissionHook = runHook({
    hook_event_name: "PermissionRequest",
    eventId: "hook-permission-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    tool_input: {
      command: "echo hook approval",
      description: "Smoke test permission request"
    }
  }, clientToken, {
    ASKKING_APPROVAL_TIMEOUT_SECONDS: "20"
  });
  const hookApprovalEvent = await waitForEvent(paired.sessionToken, "approval", "echo hook approval");
  const hookApprovalDetail = await requestJson(`${baseUrl}/api/mobile/approvals/${hookApprovalEvent.id}`, {
    headers: authHeaders(paired.sessionToken)
  });
  assert(hookApprovalDetail.approval.commandFull === "echo hook approval", "PermissionRequest hook reads nested tool_input command");
  assert(hookApprovalDetail.approval.reason === "Smoke test permission request", "PermissionRequest hook reads nested tool_input description");
  await requestJson(`${baseUrl}/api/mobile/approvals/${hookApprovalEvent.id}/decision`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ decision: "allow" })
  });
  const permissionHookOutput = JSON.parse(await permissionHook);
  assert(
    permissionHookOutput.hookSpecificOutput?.decision?.behavior === "allow",
    "PermissionRequest hook returns allow after iOS decision"
  );

  const deniedPermissionHook = runHook({
    hookEventName: "PermissionRequest",
    eventId: "hook-permission-deny-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    command: "echo hook denial",
    reason: "Smoke test denial request"
  }, clientToken, {
    ASKKING_APPROVAL_TIMEOUT_SECONDS: "20"
  });
  const hookDenialEvent = await waitForEvent(paired.sessionToken, "approval", "echo hook denial");
  await requestJson(`${baseUrl}/api/mobile/approvals/${hookDenialEvent.id}/decision`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ decision: "deny" })
  });
  const deniedPermissionHookOutput = JSON.parse(await deniedPermissionHook);
  assert(
    deniedPermissionHookOutput.hookSpecificOutput?.decision?.behavior === "deny",
    "PermissionRequest hook returns deny after iOS denial"
  );

  const expiringApproval = await requestJson(`${baseUrl}/api/codex/approvals`, {
    method: "POST",
    headers: authHeaders(clientToken),
    body: JSON.stringify({
      projectName: "Smoke",
      commandSummary: "echo expires",
      ttlSeconds: 1
    })
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const expiredApprovalWait = await requestJson(`${baseUrl}/api/codex/approvals/${expiringApproval.approval.id}/wait?timeoutMs=1000`, {
    headers: { authorization: `Bearer ${clientToken}` }
  });
  assert(expiredApprovalWait.approval.status === "expired", "pending approval expires instead of auto-allowing");

  const timeoutPermissionHookOutput = JSON.parse(await runHook({
    hookEventName: "PermissionRequest",
    eventId: "hook-permission-timeout-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    command: "echo hook timeout",
    reason: "Smoke test timeout request"
  }, clientToken, {
    ASKKING_APPROVAL_TIMEOUT_SECONDS: "1"
  }));
  assert(
    Object.keys(timeoutPermissionHookOutput).length === 0,
    "PermissionRequest hook falls back to default Codex approval on timeout"
  );

  const stopHook = runHook({
    hookEventName: "Stop",
    eventId: "hook-stop-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    summary: "Hook stop completed."
  }, clientToken, {
    ASKKING_STOP_WAIT_SECONDS: "20"
  });
  const hookCompletionEvent = await waitForEvent(paired.sessionToken, "completion", "Hook stop completed.");
  await requestJson(`${baseUrl}/api/mobile/completions/${hookCompletionEvent.id}/reply`, {
    method: "POST",
    headers: authHeaders(paired.sessionToken),
    body: JSON.stringify({ reply: "continue from hook smoke" })
  });
  const stopHookOutput = JSON.parse(await stopHook);
  assert(stopHookOutput.decision === "block", "Stop hook blocks to continue");
  assert(stopHookOutput.reason === "continue from hook smoke", "Stop hook returns continuation prompt");

  const stopHookWithoutReply = await runHook({
    hookEventName: "Stop",
    eventId: "hook-stop-no-reply-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    summary: "Hook stop no reply."
  }, clientToken, {
    ASKKING_STOP_WAIT_SECONDS: "1"
  });
  assert(stopHookWithoutReply === "{}", "Stop hook returns empty JSON when no continuation reply arrives");

  const stopHookNotifyOnly = await runHook({
    hookEventName: "Stop",
    eventId: "hook-stop-notify-only-smoke",
    sessionId: "hook-notify-only-session",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    summary: "Hook stop notify only."
  }, clientToken, {
    ASKKING_STOP_MODE: "notify_only",
    ASKKING_STOP_WAIT_SECONDS: "20"
  });
  assert(stopHookNotifyOnly === "{}", "Stop hook notify-only returns immediately");
  const notifyOnlyEvent = await waitForEvent(paired.sessionToken, "completion", "Hook stop notify only.");
  assert(notifyOnlyEvent.status === "notified", "Stop hook notify-only creates notified completion");

  const userPromptSubmitOutput = await runHook({
    hookEventName: "UserPromptSubmit",
    eventId: "hook-user-prompt-submit-smoke",
    sessionId: "hook-notify-only-session",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    prompt: "continue after notify-only from Mac"
  }, clientToken);
  assert(userPromptSubmitOutput === "{}", "UserPromptSubmit hook returns empty JSON");
  const locallyContinuedEvent = await requestJson(`${baseUrl}/api/mobile/completions/${notifyOnlyEvent.id}`, {
    headers: authHeaders(paired.sessionToken)
  });
  assert(locallyContinuedEvent.completion.status === "replied", "UserPromptSubmit marks notify-only completion replied");
  assert(locallyContinuedEvent.completion.reply === "continue after notify-only from Mac", "UserPromptSubmit stores local prompt");

  const stopHookWithAssistantMessage = runHook({
    hookEventName: "Stop",
    eventId: "hook-stop-assistant-message-smoke",
    projectName: "Smoke",
    cwd: process.cwd(),
    model: "smoke-model",
    last_assistant_message: "Finished real work from the assistant message."
  }, clientToken, {
    ASKKING_STOP_WAIT_SECONDS: "1"
  });
  await waitForEvent(paired.sessionToken, "completion", "Finished real work from the assistant message.");
  assert(await stopHookWithAssistantMessage === "{}", "Stop hook summary falls back to last assistant message");

  console.log("AskKing local smoke test passed");
} finally {
  if (server) server.kill("SIGTERM");
  await rm(workDir, { recursive: true, force: true });
}

function jsonHeaders() {
  return { "content-type": "application/json" };
}

function authHeaders(token) {
  return { ...jsonHeaders(), authorization: `Bearer ${token}` };
}

async function requestJson(url, options = {}) {
  const response = await request(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed with ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function request(url, options = {}, expectOk = true) {
  const response = await fetch(url, options);
  if (expectOk && !response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 10_000;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Relay exited early with code ${child.exitCode}: ${stderr}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Relay did not become healthy: ${stderr}`);
}

async function waitForEvent(sessionToken, kind, summary) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await requestJson(`${baseUrl}/api/mobile/events?limit=100`, {
      headers: { authorization: `Bearer ${sessionToken}` }
    });
    const event = response.events.find((item) => item.kind === kind && item.summary === summary);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${kind} event with summary ${summary}`);
}

function runHook(payload, clientToken, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["hooks/askking_codex_hook.py"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASKKING_RELAY_URL: baseUrl,
        ASKKING_CLIENT_TOKEN: clientToken,
        ...extraEnv
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`hook exited ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

function match(text, pattern) {
  const result = text.match(pattern);
  if (!result?.[1]) throw new Error(`Could not match ${pattern} in ${text}`);
  return result[1].trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
