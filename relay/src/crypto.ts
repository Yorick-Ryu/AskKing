import { createHash, randomBytes } from "node:crypto";

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function randomCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  const bytes = randomBytes(8);
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redact(value: string): string {
  return value
    .replace(/([A-Za-z0-9_]*api[_-]?key[A-Za-z0-9_]*=)[^\s&]+/gi, "$1[redacted]")
    .replace(/([A-Za-z0-9_]*token[A-Za-z0-9_]*=)[^\s&]+/gi, "$1[redacted]")
    .replace(/([A-Za-z0-9_]*password[A-Za-z0-9_]*=)[^\s&]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}
