#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict


BASE_URL = os.environ.get("ASKKING_RELAY_URL", "http://localhost:8787").rstrip("/")
CLIENT_TOKEN = os.environ.get("ASKKING_CLIENT_TOKEN", "")
APPROVAL_TIMEOUT_SECONDS = int(os.environ.get("ASKKING_APPROVAL_TIMEOUT_SECONDS", "600"))
STOP_WAIT_SECONDS = int(os.environ.get("ASKKING_STOP_WAIT_SECONDS", "45"))


def post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {CLIENT_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def get(path: str) -> Dict[str, Any]:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        headers={"authorization": f"Bearer {CLIENT_TOKEN}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=65) as response:
        return json.loads(response.read().decode("utf-8"))


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {
                "behavior": "deny",
                "message": reason,
            },
        }
    }))


def allow() -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {
                "behavior": "allow",
            },
        }
    }))


def stop_continue(prompt: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "Stop",
            "decision": "block",
            "reason": prompt,
        }
    }))


def stop_ok() -> None:
    print(json.dumps({}))


def first_string(payload: Dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


def summarize_command(payload: Dict[str, Any]) -> str:
    command = first_string(payload, "command", "cmd", "tool_input", "toolInput", "description", default="Codex command")
    return command if len(command) <= 180 else command[:177] + "..."


def project_name(payload: Dict[str, Any]) -> str:
    explicit = first_string(payload, "projectName", "project_name")
    if explicit:
        return explicit
    cwd = first_string(payload, "cwd", "workingDirectory", "working_directory")
    if cwd:
        return os.path.basename(cwd.rstrip(os.sep)) or "AskKing"
    return os.environ.get("ASKKING_PROJECT_NAME", "AskKing")


def handle_permission(payload: Dict[str, Any]) -> None:
    if not CLIENT_TOKEN:
        deny("AskKing is not configured: ASKKING_CLIENT_TOKEN is missing.")
        return
    try:
        created = post("/api/codex/approvals", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "commandSummary": summarize_command(payload),
            "commandFull": first_string(payload, "command", "cmd", "tool_input", "toolInput", default=summarize_command(payload)),
            "reason": first_string(payload, "reason", "justification", default="Codex requested permission."),
            "riskSummary": first_string(payload, "riskSummary", "risk_summary", default="Review before allowing."),
            "ttlSeconds": APPROVAL_TIMEOUT_SECONDS,
        })
        approval = created["approval"]
        deadline = time.time() + APPROVAL_TIMEOUT_SECONDS
        while time.time() < deadline:
            waited = get(f"/api/codex/approvals/{approval['id']}/wait?timeoutMs=30000")["approval"]
            if waited["status"] == "allowed":
                allow()
                return
            if waited["status"] in ("denied", "expired"):
                deny("AskKing denied or expired this approval request.")
                return
        deny("AskKing approval timed out.")
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError) as error:
        deny(f"AskKing relay error: {error}")


def handle_stop(payload: Dict[str, Any]) -> None:
    if not CLIENT_TOKEN:
        stop_ok()
        return
    try:
        created = post("/api/codex/completions", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "summary": first_string(payload, "summary", "message", default="Codex turn completed."),
            "ttlSeconds": STOP_WAIT_SECONDS,
        })
        completion = created["completion"]
        waited = get(f"/api/codex/completions/{completion['id']}/wait?timeoutMs={STOP_WAIT_SECONDS * 1000}")["completion"]
        if waited["status"] == "replied" and waited.get("reply"):
            stop_continue(waited["reply"])
        else:
            stop_ok()
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError):
        stop_ok()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        deny("AskKing could not parse Codex hook payload.")
        return 0

    hook_name = first_string(payload, "hookEventName", "hook_event_name", "event", "type")
    if hook_name == "PermissionRequest":
        handle_permission(payload)
    elif hook_name == "Stop":
        handle_stop(payload)
    else:
        print(json.dumps({}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
