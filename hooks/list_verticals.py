"""Print the vertical chats of one parent session as JSON, read-only.

Usage: list_verticals.py <store dir> <parent session id>
Reads chat-verticali's own store files (chat-verticali_gorlix-chat-verticali-*.json:
an object whose `v:<sessionId>` keys hold one vertical each) and keeps the ones
whose parentSessionId is the given session. Active first, then paused, then done;
newest first inside each.
"""
import glob
import json
import os
import sys

folder = sys.argv[1]
parent = sys.argv[2] if len(sys.argv) > 2 else ""
ORDER = {"active": 0, "paused": 1, "done": 2}
out = []
for path in glob.glob(os.path.join(folder, "chat-verticali_gorlix-chat-verticali-*.json")):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        continue
    if not isinstance(data, dict):
        continue
    for key, v in data.items():
        if not key.startswith("v:") or not isinstance(v, dict):
            continue
        if not parent or v.get("parentSessionId") != parent:
            continue
        pct = v.get("contextPercent")
        out.append(
            {
                "id": v.get("sessionId") or key[2:],
                "slug": str(v.get("slug") or ""),
                "title": str(v.get("title") or ""),
                "status": v.get("status") if v.get("status") in ORDER else "done",
                "contextPercent": pct if isinstance(pct, (int, float)) else None,
                "createdAt": str(v.get("createdAt") or ""),
            }
        )
out.sort(key=lambda r: r["createdAt"], reverse=True)
out.sort(key=lambda r: ORDER[r["status"]])
print(json.dumps(out, ensure_ascii=False))
