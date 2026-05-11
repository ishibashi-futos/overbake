#!/usr/bin/env python3
import json
import os
import re
import sys


REPO_ROOT = os.path.realpath(
    os.environ.get("CLAUDE_PROJECT_DIR")
    or os.environ.get("PWD")
    or os.getcwd()
)
ISSUES_DIR = os.path.join(REPO_ROOT, "issues")


def is_under_issues(path: str) -> bool:
    if not path:
        return False
    real = os.path.realpath(path if os.path.isabs(path) else os.path.join(REPO_ROOT, path))
    return real == ISSUES_DIR or real.startswith(ISSUES_DIR + os.sep)


def command_touches_issues(command: str) -> bool:
    if not command:
        return False
    patterns = [
        r"(^|[;&|]\s*)(rm|mv|cp|mkdir|touch|truncate|install|rsync)\b[^;&|]*\bissues(/|\b)",
        r"(^|[;&|]\s*)git\s+(clean|checkout|restore|reset)\b[^;&|]*\bissues(/|\b)",
        r"(^|[;&|]\s*)find\b[^;&|]*\bissues(/|\b)[^;&|]*\s+(-delete|-exec\b)",
        r">\s*issues/",
        r">\s*\./issues/",
    ]
    return any(re.search(pattern, command) for pattern in patterns)


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    sys.exit(2)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return

    tool_name = payload.get("tool_name") or payload.get("name") or ""
    tool_input = payload.get("tool_input") or payload.get("input") or {}

    file_path = tool_input.get("file_path") or tool_input.get("path") or ""
    if tool_name in {"Write", "Edit", "MultiEdit", "NotebookEdit"} and is_under_issues(file_path):
        block("issues/ is read-only for Claude. Do not write, edit, move, or delete issue files.")

    command = tool_input.get("command") or ""
    if tool_name in {"Bash", "Shell"} and command_touches_issues(command):
        block("Bash command appears to modify issues/. issues/ is read-only for Claude.")


if __name__ == "__main__":
    main()
