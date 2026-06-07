export type ApprovalStatus = "pending" | "allowed" | "denied" | "expired";
export type CompletionStatus = "notified" | "waiting" | "replied" | "interrupted" | "expired";
export type HookMode = "off" | "notify" | "approval" | "full";

export type ApprovalRequest = {
  id: string;
  clientId: string;
  eventId: string;
  projectName: string;
  cwd: string;
  model: string;
  commandSummary: string;
  commandFull: string;
  reason: string;
  riskSummary: string;
  status: ApprovalStatus;
  notifyOnly: boolean;
  decisionSource: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
};

export type CompletionEvent = {
  id: string;
  clientId: string;
  eventId: string;
  projectName: string;
  cwd: string;
  model: string;
  sessionKey: string;
  summary: string;
  status: CompletionStatus;
  notifyOnly: boolean;
  createdAt: string;
  expiresAt: string;
  reply: string | null;
  repliedAt: string | null;
};

export type Device = {
  id: string;
  clientId: string;
  name: string;
  apnsToken: string | null;
  sessionTokenHash: string;
  enabled: number;
  createdAt: string;
  lastSeenAt: string;
};

export type CodexClient = {
  id: string;
  name: string;
  defaultProjectName: string;
  clientTokenHash: string;
  enabled: number;
  createdAt: string;
  lastSeenAt: string;
};
