export type ApprovalStatus = "pending" | "allowed" | "denied" | "expired";
export type CompletionStatus = "notified" | "waiting" | "replied" | "interrupted" | "expired";

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
  createdAt: string;
  expiresAt: string;
  reply: string | null;
  repliedAt: string | null;
};

export type Device = {
  id: string;
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
