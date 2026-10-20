"""Print the Claude Code sessions that are running now as JSON.

Usage: running_sessions.py <sessions dir>   (normally ~/.claude/sessions)
Reads <pid>.json only, never the *.key files. Of each file it keeps sessionId,
pid and the tmux location ("session:@window.%pane", empty outside tmux); every
other field (tokens included) is dropped. Files of dead pids are skipped.
Output: [{"sessionId", "pid", "windowId" (@N or null), "paneId" (%N or null)}]
"""
import json
import os
import re
import sys

folder = sys.argv[1]
window_re = re.compile(r"@\d+")
pane_re = re.compile(r"%\d+")


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return os.path.exists("/proc/%d" % pid)
    return True


out = []
for name in sorted(os.listdir(folder)):
    if not name.endswith(".json"):
        continue
    try:
        with open(os.path.join(folder, name)) as f:
            data = json.load(f)
    except (OSError, ValueError):
        continue
    if not isinstance(data, dict):
        continue
    sid = data.get("sessionId")
    pid = data.get("pid")
    if not isinstance(sid, str) or not sid or isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or not alive(pid):
        continue
    tmux = data.get("tmux") if isinstance(data.get("tmux"), str) else ""
    w = window_re.search(tmux)
    p = pane_re.search(tmux)
    out.append({"sessionId": sid, "pid": pid, "windowId": w.group(0) if w else None, "paneId": p.group(0) if p else None})

print(json.dumps(out))
