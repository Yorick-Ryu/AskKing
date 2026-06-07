#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict


def config_paths() -> list[Path]:
    paths: list[Path] = []
    explicit = os.environ.get("ASKKING_PLUGIN_CONFIG")
    if explicit:
        paths.append(Path(explicit).expanduser())
    plugin_data = os.environ.get("PLUGIN_DATA")
    if plugin_data:
        paths.append(Path(plugin_data).expanduser() / "config.json")
    paths.append(Path("~/.codex/askking/config.json").expanduser())
    return paths


def load_plugin_config() -> Dict[str, Any]:
    for path in config_paths():
        try:
            with path.open(encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict):
                return payload
        except (OSError, json.JSONDecodeError):
            continue
    return {}


PLUGIN_CONFIG = load_plugin_config()
BASE_URL = os.environ.get("ASKKING_RELAY_URL", str(PLUGIN_CONFIG.get("relayUrl") or "http://localhost:8787")).rstrip("/")
CLIENT_TOKEN = os.environ.get("ASKKING_CLIENT_TOKEN", str(PLUGIN_CONFIG.get("clientToken") or ""))
COMPLETION_SUMMARY_LIMIT = int(os.environ.get("ASKKING_COMPLETION_SUMMARY_LIMIT", "4000"))


def post(path: str, payload: Dict[str, Any], timeout: int = 10) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {CLIENT_TOKEN}",
            "user-agent": "CodexDoneHook/0.1",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def ok() -> None:
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


def summarize_completion(payload: Dict[str, Any]) -> str:
    summary = first_string(
        payload,
        "summary",
        "last_assistant_message",
        "message",
        default="Codex turn completed.",
    )
    return summary if len(summary) <= COMPLETION_SUMMARY_LIMIT else summary[:COMPLETION_SUMMARY_LIMIT - 3] + "..."


def is_suggestions_summary(summary: str) -> bool:
    try:
        value = json.loads(summary)
    except json.JSONDecodeError:
        return False
    return isinstance(value, dict) and isinstance(value.get("suggestions"), list)


def project_name(payload: Dict[str, Any]) -> str:
    explicit = first_string(payload, "projectName", "project_name")
    if explicit:
        return explicit
    cwd = first_string(payload, "cwd", "workingDirectory", "working_directory")
    if cwd:
        return os.path.basename(cwd.rstrip(os.sep)) or "Codex"
    return os.environ.get("ASKKING_PROJECT_NAME", "Codex")


def session_key(payload: Dict[str, Any]) -> str:
    return nested_string(
        payload,
        "session_id",
        "transcript_path",
        default="",
    )


def handle_stop(payload: Dict[str, Any]) -> None:
    if not CLIENT_TOKEN:
        ok()
        return
    try:
        summary = summarize_completion(payload)
        if is_suggestions_summary(summary):
            ok()
            return
        post("/api/codex/completions", {
            "eventId": first_string(payload, "eventId", "event_id", "turnId", "turn_id", default=str(time.time())),
            "projectName": project_name(payload),
            "cwd": first_string(payload, "cwd", "workingDirectory", "working_directory", default=os.getcwd()),
            "model": first_string(payload, "model", default=os.environ.get("ASKKING_MODEL", "")),
            "sessionKey": session_key(payload),
            "summary": summary,
            "waitForReply": False,
            "ttlSeconds": 45,
            "notifyOnly": True,
        })
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError, TimeoutError):
        pass
    ok()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        ok()
        return 0

    hook_name = first_string(payload, "hookEventName", "hook_event_name", "event", "type")
    if hook_name == "Stop":
        handle_stop(payload)
    else:
        ok()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
