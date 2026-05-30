#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_MODE_FILE = Path("~/.codex/askking-hook-mode.json").expanduser()

MODE_ALIASES = {
    "0": "off",
    "disable": "off",
    "disabled": "off",
    "none": "off",
    "noop": "off",
    "off": "off",
    "无": "off",
    "无行为": "off",
    "1": "notify",
    "2": "notify",
    "notification": "notify",
    "notification_only": "notify",
    "notify": "notify",
    "notify_only": "notify",
    "仅通知": "notify",
    "只通知": "notify",
    "3": "approval",
    "approval": "approval",
    "approval_only": "approval",
    "approval_notify": "approval",
    "approval_notify_completion": "approval",
    "handoff_approval": "approval",
    "permission": "approval",
    "permission_only": "approval",
    "仅交接审批": "approval",
    "仅交接审批并通知完成": "approval",
    "4": "full",
    "all": "full",
    "full": "full",
    "wait": "full",
    "全量": "full",
}

MODE_DESCRIPTIONS = {
    "off": "无行为：AskKing hook 不创建审批或完成事件。",
    "notify": "仅通知：通知审批请求和完成事件，但不交接审批，也不等待继续指令。",
    "approval": "仅交接审批并通知完成：审批交给 iPhone，完成只通知。",
    "full": "Full：审批交给 iPhone，完成通知后等待继续指令。",
}


def normalize_mode(value: str) -> str:
    mode = MODE_ALIASES.get(value.strip().lower(), "")
    if not mode:
        allowed = ", ".join(MODE_DESCRIPTIONS)
        raise ValueError(f"unknown mode '{value}'. Expected one of: {allowed}")
    return mode


def read_mode(path: Path) -> str:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return normalize_mode(str(payload.get("mode", "")))
    except FileNotFoundError:
        return "full"
    except (json.JSONDecodeError, ValueError):
        return "full"
    return "full"


def write_mode(path: Path, mode: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mode": mode,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Get or set AskKing Codex hook mode.")
    parser.add_argument(
        "mode",
        nargs="?",
        help="off, notify, approval, or full. Omit to print the current mode.",
    )
    parser.add_argument(
        "--file",
        default=os.environ.get("ASKKING_HOOK_MODE_FILE", str(DEFAULT_MODE_FILE)),
        help="Mode file read by hooks.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mode_file = Path(args.file).expanduser()
    if args.mode:
        try:
            mode = normalize_mode(args.mode)
        except ValueError as error:
            print(error, file=sys.stderr)
            return 2
        write_mode(mode_file, mode)
    else:
        mode = read_mode(mode_file)
    print(f"{mode}: {MODE_DESCRIPTIONS[mode]}")
    print(f"mode_file: {mode_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
