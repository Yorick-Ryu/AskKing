# MVP Audit

Current status against `codex-ios-approval-relay-prd.md`.

## Implemented

- Codex `PermissionRequest` hook adapter.
- Codex `Stop` hook adapter with short continuation wait.
- Local Relay: Hono + SQLite.
- Public Relay path: AWS Lambda handler + DynamoDB store + SAM template.
- Device pairing with short-lived pairing code.
- Separate Codex client token and iOS session token.
- Admin list and revoke APIs for Codex clients and iOS devices.
- iOS SwiftUI client with Messages, Connection, and Settings tabs.
- iOS Connection tab supports connection testing, re-pairing, and one-tap hook config summary copy.
- iOS approval details and allow/deny.
- iOS completion details and continuation reply.
- APNs sender using token-based provider authentication.
- iOS APNs device token registration.
- Notification categories and actions for allow, deny, and reply.
- Conservative timeout behavior: approvals expire instead of auto-allowing.
- Server-side command redaction, notification-safe summary truncation, and simple high-risk keyword marking.

## Verified Locally

- TypeScript typecheck and build.
- Python hook syntax.
- iOS simulator build with signing disabled.
- Automated local Relay and hook smoke test via `pnpm smoke:local`: unauthorized client, approval creation, pairing, iOS decision, repeated decision idempotency, server-side command redaction, summary truncation, high-risk marking, client and device revoke rejection, approval expiry without auto-allow, Codex approval wait, completion creation, iOS continuation reply, Codex completion wait, actual Python `PermissionRequest` hook allow, deny, and timeout-deny outputs, actual Python `Stop` hook continuation output, and Stop no-reply normal `{}` output.

## Needs External Verification

- Real APNs delivery within 5 seconds on a signed iPhone build.
- Real notification actions from lock screen/background on an iPhone.
- AWS SAM deployment against an AWS account.
- Custom HTTPS domain for public deployment.
- Secrets Manager based APNs key loading for production hardening.

## Deferred By PRD

- Android client.
- Web admin.
- Team permissions.
- Full audit platform.
- Complex rule engine.
- Long-after-finish task recovery.
