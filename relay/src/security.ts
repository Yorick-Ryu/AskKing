import { redact } from "./crypto.js";

const SUMMARY_LIMIT = 180;
const HIGH_RISK_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bdiskutil\s+(erase|partition|unmount)/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkill\s+-9\b/i,
  /\bcurl\b.+\|\s*(sh|bash|zsh)\b/i,
  /\bwget\b.+\|\s*(sh|bash|zsh)\b/i
];

export function sanitizeCommand(value: string) {
  return redact(value).replace(/\s+/g, " ").trim();
}

export function commandSummary(value: string) {
  const sanitized = sanitizeCommand(value);
  if (sanitized.length <= SUMMARY_LIMIT) return sanitized;
  return `${sanitized.slice(0, SUMMARY_LIMIT - 3)}...`;
}

export function riskSummary(command: string, fallback: string) {
  const sanitized = sanitizeCommand(command);
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return "High risk command detected. Review in app before allowing.";
  }
  return fallback.trim();
}
