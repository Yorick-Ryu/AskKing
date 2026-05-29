import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { RelayConfig } from "./config.js";
import type { ApprovalRequest, CompletionEvent, Device } from "./types.js";

type PushPayload = {
  aps: {
    alert: {
      title: string;
      subtitle?: string;
      body: string;
    };
    category?: string;
    sound?: string;
    "thread-id"?: string;
  };
  kind: "approval" | "completion";
  id: string;
};

export class ApnsSender {
  private key: string | null = null;
  private keyPromise: Promise<string> | null = null;

  constructor(private config: RelayConfig["apns"]) {
    if (config.enabled && config.keyPath) this.key = readFileSync(config.keyPath, "utf8");
  }

  async sendApproval(devices: Device[], approval: ApprovalRequest) {
    const isHighRisk = approval.riskSummary.toLowerCase().includes("high risk");
    await this.broadcast(devices, {
      aps: {
        alert: {
          title: "Codex 需要批准",
          body: notificationBody(approval.projectName, "命令", approval.commandSummary)
        },
        category: isHighRisk ? "ASKKING_APPROVAL_REVIEW" : "ASKKING_APPROVAL",
        sound: "default",
        "thread-id": approval.id
      },
      kind: "approval",
      id: approval.id
    });
  }

  async sendCompletion(devices: Device[], completion: CompletionEvent) {
    await this.broadcast(devices, {
      aps: {
        alert: {
          title: "Codex 已完成",
          body: notificationBody(completion.projectName, "结果", completion.summary)
        },
        category: "ASKKING_COMPLETION",
        sound: "default",
        "thread-id": completion.id
      },
      kind: "completion",
      id: completion.id
    });
  }

  private async broadcast(devices: Device[], payload: PushPayload) {
    if (!devices.length) {
      console.warn("[apns] no paired devices with APNs token");
      return;
    }
    if (!this.config.enabled) {
      console.info("[apns] disabled; would send", payload.kind, payload.id, "to", devices.length, "device(s)");
      return;
    }
    await Promise.all(devices.map((device) => device.apnsToken ? this.send(device.apnsToken, payload) : undefined));
  }

  private async send(deviceToken: string, payload: PushPayload) {
    const host = this.config.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    const client = http2.connect(host);
    let jwt: string;
    try {
      jwt = await this.jwt();
    } catch (error) {
      client.close();
      throw error;
    }
    return new Promise<void>((resolve, reject) => {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": this.config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10"
      });
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("error", (error) => {
        client.close();
        reject(error);
      });
      req.on("end", () => {
        client.close();
        if (body) console.warn("[apns] response", body);
        resolve();
      });
      req.end(JSON.stringify(payload));
    });
  }

  private async jwt() {
    const key = await this.loadKey();
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: this.config.keyId })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({ iss: this.config.teamId, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
    const sign = createSign("sha256");
    sign.update(`${header}.${claims}`);
    sign.end();
    const signature = sign.sign(key).toString("base64url");
    return `${header}.${claims}.${signature}`;
  }

  private async loadKey() {
    if (this.key) return this.key;
    if (!this.keyPromise) {
      this.keyPromise = this.loadKeyFromSecret().then((key) => {
        this.key = key;
        return key;
      });
    }
    return this.keyPromise;
  }

  private async loadKeyFromSecret() {
    if (!this.config.keySecretId) {
      throw new Error("ASKKING_APNS_KEY_PATH or ASKKING_APNS_KEY_SECRET_ID is required when APNs is enabled");
    }
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: this.config.keySecretId }));
    if (response.SecretString) return parseSecretString(response.SecretString);
    if (response.SecretBinary) return Buffer.from(response.SecretBinary).toString("utf8");
    throw new Error(`APNs key secret ${this.config.keySecretId} has no string or binary value`);
  }
}

function notificationBody(projectName: string, label: string, value: string) {
  return [`项目：${projectName}`, `${label}：${compactNotificationText(value)}`].join("\n");
}

function compactNotificationText(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseSecretString(secret: string) {
  const trimmed = secret.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const key = parsed.privateKey ?? parsed.apnsKey ?? parsed.p8;
    if (typeof key === "string" && key.trim()) return key;
  }
  return secret;
}
