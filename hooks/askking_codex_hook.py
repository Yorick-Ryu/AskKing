#!/usr/bin/env python3
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


BASE_URL = os.environ.get("ASKKING_RELAY_URL", "http://localhost:8787").rstrip("/")
CLIENT_TOKEN = os.environ.get("ASKKING_CLIENT_TOKEN", "")
APPROVAL_TIMEOUT_SECONDS = int(os.environ.get("ASKKING_APPROVAL_TIMEOUT_SECONDS", "600"))
STOP_WAIT_SECONDS = int(os.environ.get("ASKKING_STOP_WAIT_SECONDS", "600"))
STOP_MODE = os.environ.get("ASKKING_STOP_MODE", "wait").strip().lower()
COMPLETION_SUMMARY_LIMIT = int(os.environ.get("ASKKING_COMPLETION_SUMMARY_LIMIT", "4000"))
CURRENT_COMPLETION_ID: Optional[str] = None
COMPUTER_HANDOFF_REPLY = "交接给电脑"


def post(path: str, payload: Dict[str, Any], timeout: int = 10) -> Dict[str, Any]:
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
    with urllib.request.urlopen(req, timeout=timeout) as response:
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


def permission_fallback() -> None:
    print(json.dumps({}))


def stop_continue(prompt: str) -> None:
    print(json.dumps({
        "decision": "block",
        "reason": prompt,
    }))


def stop_ok() -> None:
    print(json.dumps({}))


def first_string(payload: Dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


def nested_string(payload: Dict[str, Any], *paths: str, default: str = "") -> str:
    for path in paths:
        value: Any = payload
        for part in path.split("."):
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(part)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


def summarize_command(payload: Dict[str, Any]) -> str:
    command = nested_string(
        payload,
        "command",
        "cmd",
        "tool_input.command",
        "tool_input.cmd",
        "toolInput.command",
        "toolInput.cmd",
        "tool_input.description",
        "toolInput.description",
        "description",
        default="Codex command",
    )
    return command if len(command) <= 180 else command[:177] + "..."


def summarize_completion(payload: Dict[str, Any]) -> str:
    summary = first_string(
        payload,
        "summary",
        "last_assistant_message",
        "message",
        default="Codex turn completed.",
    )
    return summary if len(summary) <= COMPLETION_SUMMARY_LIMIT else summary[:COMPLETION_SUMMARY_LIMIT - 3] + "..."


def project_name(payload: Dict[str, Any]) -> str:
    explicit = first_string(payload, "projectName", "project_name")
    if explicit:
        return explicit
    cwd = first_string(payload, "cwd", "workingDirectory", "working_directory")
    if cwd:
        return os.path.basename(cwd.rstrip(os.sep)) or "AskKing"
    return os.environ.get("ASKKING_PROJECT_NAME", "AskKing")


def session_key(payload: Dict[str, Any]) -> str:
    return nested_string(
        payload,
        "session_id",
        "transcript_path",
        default="",
    )


def mark_completion_interrupted(completion_id: Optional[str]) -> None:
    if not completion_id or not CLIENT_TOKEN:
        return
    try:
        post(f"/api/codex/completions/{completion_id}/interrupt", {}, timeout=2)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError, TimeoutError):
        pass


def handle_exit_signal(_signum: int, _frame: Any) -> None:
    mark_completion_interrupted(CURRENT_COMPLETION_ID)
    stop_ok()
    raise SystemExit(0)


def handle_permission(payload: Dict[str, Any]) -> None:
    if not CLIENT_TOKEN:
        permission_fallback()
        return
    try:
        created = post("/api/codex/approvals", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "commandSummary": summarize_command(payload),
            "commandFull": nested_string(
                payload,
                "command",
                "cmd",
                "tool_input.command",
                "tool_input.cmd",
                "toolInput.command",
                "toolInput.cmd",
                default=summarize_command(payload),
            ),
            "reason": nested_string(
                payload,
                "reason",
                "justification",
                "permission_reason",
                "tool_input.description",
                "toolInput.description",
                default="Codex requested permission.",
            ),
            "riskSummary": first_string(payload, "riskSummary", "risk_summary"),
            "ttlSeconds": APPROVAL_TIMEOUT_SECONDS,
        })
        approval = created["approval"]
        deadline = time.time() + APPROVAL_TIMEOUT_SECONDS
        while time.time() < deadline:
            waited = get(f"/api/codex/approvals/{approval['id']}/wait?timeoutMs=30000")["approval"]
            if waited["status"] == "allowed":
                allow()
                return
            if waited["status"] == "denied":
                deny("AskKing denied this approval request.")
                return
            if waited["status"] == "expired":
                permission_fallback()
                return
        permission_fallback()
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError):
        permission_fallback()


def handle_stop(payload: Dict[str, Any]) -> None:
    global CURRENT_COMPLETION_ID
    if not CLIENT_TOKEN:
        stop_ok()
        return
    try:
        wait_for_reply = STOP_MODE not in ("notify", "notify_only", "notification_only", "none", "0")
        created = post("/api/codex/completions", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "sessionKey": session_key(payload),
            "summary": summarize_completion(payload),
            "waitForReply": wait_for_reply,
            "ttlSeconds": STOP_WAIT_SECONDS,
        })
        completion = created["completion"]
        CURRENT_COMPLETION_ID = completion["id"]
        if not wait_for_reply or STOP_WAIT_SECONDS <= 0:
            stop_ok()
            return
        deadline = time.time() + STOP_WAIT_SECONDS
        while time.time() < deadline:
            waited = get(f"/api/codex/completions/{completion['id']}/wait?timeoutMs=30000")["completion"]
            if waited["status"] == "replied" and waited.get("reply"):
                if waited["reply"].strip() == COMPUTER_HANDOFF_REPLY:
                    stop_ok()
                    return
                stop_continue(waited["reply"])
                return
            if waited["status"] == "expired":
                break
        stop_ok()
    except KeyboardInterrupt:
        mark_completion_interrupted(CURRENT_COMPLETION_ID)
        stop_ok()
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError):
        stop_ok()
    finally:
        CURRENT_COMPLETION_ID = None


def handle_user_prompt_submit(payload: Dict[str, Any]) -> None:
    if not CLIENT_TOKEN:
        stop_ok()
        return
    prompt = first_string(payload, "prompt", "userPrompt", "user_prompt", "message")
    if not prompt:
        stop_ok()
        return
    try:
        post("/api/codex/completions/local-prompt", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "sessionKey": session_key(payload),
            "prompt": prompt,
        })
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError):
        pass
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
    elif hook_name == "UserPromptSubmit":
        handle_user_prompt_submit(payload)
    else:
        print(json.dumps({}))
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_exit_signal)
    signal.signal(signal.SIGTERM, handle_exit_signal)
    raise SystemExit(main())
