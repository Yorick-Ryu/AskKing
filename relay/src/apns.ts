import type { RelayConfig } from "./config.js";
import type { CompletionEvent, Device } from "./types.js";

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
  kind: "completion";
  id: string;
  notifyOnly?: boolean;
};

export class ApnsSender {
  private key: CryptoKey | null = null;
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private config: RelayConfig["apns"]) {}

  async sendCompletion(devices: Device[], completion: CompletionEvent) {
    await this.broadcast(devices, {
      aps: {
        alert: {
          title: "Codex 已完成",
          body: notificationBody(completion.projectName, "结果", completion.summary)
        },
        sound: "default",
        "thread-id": completion.id
      },
      kind: "completion",
      id: completion.id,
      notifyOnly: true
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
    console.info("[apns] sending", payload.kind, payload.id, "to", devices.filter((device) => device.apnsToken).length, "device(s)");
    await Promise.all(devices.map((device) => device.apnsToken ? this.send(device.apnsToken, payload) : undefined));
  }

  private async send(deviceToken: string, payload: PushPayload) {
    const host = this.config.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    const response = await fetch(`${host}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await this.jwt()}`,
        "apns-topic": this.config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.warn("[apns] response", response.status, await response.text());
    } else {
      console.info("[apns] delivered", payload.kind, payload.id, response.status);
    }
  }

  private async jwt() {
    const key = await this.loadKey();
    const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: this.config.keyId }));
    const claims = base64UrlEncode(JSON.stringify({ iss: this.config.teamId, iat: Math.floor(Date.now() / 1000) }));
    const signature = base64UrlEncode(new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(`${header}.${claims}`)
    )));
    return `${header}.${claims}.${signature}`;
  }

  private async loadKey() {
    if (this.key) return this.key;
    if (!this.keyPromise) {
      this.keyPromise = Promise.resolve(this.loadKeyText()).then(async (keyText) => {
        this.key = await importPrivateKey(keyText);
        return this.key;
      });
    }
    return this.keyPromise;
  }

  private loadKeyText() {
    if (!this.config.keyText) {
      throw new Error("ASKKING_APNS_KEY or ASKKING_APNS_KEY_PATH is required when APNs is enabled");
    }
    return parseSecretString(this.config.keyText);
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

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importPrivateKey(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}
