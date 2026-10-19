"""Print the saved sessions of one project folder as JSON, newest first.

Usage: list_sessions.py <project dir> [current session id] [--prefix HOME]
Title: last /rename (custom-title), else last ai-title, else last prompt.
pacaRef: the latest `<PREFIX>-<n>` the user typed or a PACA/Bash/Skill tool call
carried (null without --prefix); tool results are skipped, they list many tasks.
"""
import json
import os
import re
import sys

args = sys.argv[1:]
prefix = ""
if "--prefix" in args:
    i = args.index("--prefix")
    prefix = args[i + 1] if i + 1 < len(args) else ""
    del args[i : i + 2]
folder = args[0]
current = args[1] if len(args) > 1 else ""
marker = prefix + "-"
ref_re = re.compile(r"\b" + re.escape(prefix) + r"-\d+\b") if prefix else None
paca_tool = re.compile(r"^mcp__paca[\w-]*__")


def last_ref(text):
    found = ref_re.findall(text)
    return found[-1] if found else None


def line_ref(obj):
    """Latest ref in one transcript row, from user text or tool call inputs."""
    content = (obj.get("message") or {}).get("content")
    kind = obj.get("type")
    if kind == "user":
        if isinstance(content, str):
            return last_ref(content)
        found = None
        for block in content or []:
            if isinstance(block, dict) and block.get("type") == "text":
                found = last_ref(block.get("text") or "") or found
        return found
    if kind == "assistant":
        found = None
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name") or ""
            inp = block.get("input") or {}
            if paca_tool.match(name) or name in ("Bash", "Skill"):
                found = last_ref(json.dumps(inp, ensure_ascii=False)) or found
                if name.endswith("__get_task_by_number"):
                    num = inp.get("taskNumber", inp.get("number"))
                    if isinstance(num, int):
                        found = f"{prefix}-{num}"
        return found
    return None


rows = []
for name in os.listdir(folder):
    if not name.endswith(".jsonl"):
        continue
    sid = name[: -len(".jsonl")]
    path = os.path.join(folder, name)
    custom = ai = prompt = ""
    pref = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            titled = '"custom-title"' in line or '"ai-title"' in line or '"last-prompt"' in line
            # Cheap substring checks before any json.loads.
            wants_ref = (
                ref_re is not None
                and ("get_task_by_number" in line or marker in line)
                and '"tool_result"' not in line
            )
            if not (titled or wants_ref):
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            kind = obj.get("type")
            if kind == "custom-title":
                custom = obj.get("customTitle") or custom
            elif kind == "ai-title":
                ai = obj.get("aiTitle") or ai
            elif kind == "last-prompt":
                prompt = obj.get("lastPrompt") or prompt
            elif wants_ref:
                pref = line_ref(obj) or pref
    stat = os.stat(path)
    rows.append({
        "id": sid,
        "title": (custom or ai or prompt or "(senza titolo)").strip().splitlines()[0],
        "mtime": int(stat.st_mtime * 1000),
        "isCurrent": sid == current,
        "pacaRef": pref,
    })
rows.sort(key=lambda r: r["mtime"], reverse=True)
print(json.dumps(rows))
