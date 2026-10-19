"""Print one saved session's title, or nothing.

Usage: session_title.py <session .jsonl>
Title: last /rename (custom-title), else last ai-title, else first prompt line.
"""
import json
import sys

custom = ai = prompt = ""
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"custom-title"' not in line and '"ai-title"' not in line and '"last-prompt"' not in line:
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
            elif kind == "last-prompt" and not prompt:
                prompt = obj.get("lastPrompt") or ""
except OSError:
    sys.exit(0)
title = (custom or ai or prompt).strip()
print(title.splitlines()[0] if title else "")
