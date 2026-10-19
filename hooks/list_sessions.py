"""Print the saved sessions of one project folder as JSON, newest first.

Usage: list_sessions.py <project dir> [current session id]
Title: last /rename (custom-title), else last ai-title, else last prompt.
"""
import json
import os
import sys

folder = sys.argv[1]
current = sys.argv[2] if len(sys.argv) > 2 else ""
rows = []
for name in os.listdir(folder):
    if not name.endswith(".jsonl"):
        continue
    sid = name[: -len(".jsonl")]
    path = os.path.join(folder, name)
    custom = ai = prompt = ""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"custom-title"' in line or '"ai-title"' in line or '"last-prompt"' in line:
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
    stat = os.stat(path)
    rows.append({
        "id": sid,
        "title": (custom or ai or prompt or "(senza titolo)").strip().splitlines()[0],
        "mtime": int(stat.st_mtime * 1000),
        "isCurrent": sid == current,
    })
rows.sort(key=lambda r: r["mtime"], reverse=True)
print(json.dumps(rows))
