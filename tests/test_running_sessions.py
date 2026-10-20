import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "hooks", "running_sessions.py")


def dead_pid():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


class RunningSessions(unittest.TestCase):
    def run_on(self, files):
        with tempfile.TemporaryDirectory() as d:
            for name, data in files.items():
                with open(os.path.join(d, name), "w") as f:
                    f.write(data if isinstance(data, str) else json.dumps(data))
            out = subprocess.run([sys.executable, "-I", SCRIPT, d], capture_output=True, text=True, check=True)
        return out.stdout, json.loads(out.stdout)

    def test_alive_only_with_just_the_wanted_keys(self):
        me = os.getpid()
        raw, got = self.run_on(
            {
                "%d.json" % me: {"sessionId": "aaa", "pid": me, "cwd": "/x", "tmux": "Default-G:@18.%18", "status": "busy", "peerToken": "SECRET-TOKEN"},
                "dead.json": {"sessionId": "bbb", "pid": dead_pid(), "tmux": "S:@1.%1", "peerToken": "SECRET-TOKEN"},
                "notmux.json": {"sessionId": "ccc", "pid": me, "peerToken": "SECRET-TOKEN"},
                "empty.json": {"sessionId": "ddd", "pid": me, "tmux": ""},
                "broken.json": "{not json",
                "other.key": "SECRET-TOKEN",
            }
        )
        self.assertNotIn("SECRET-TOKEN", raw)
        by = {r["sessionId"]: r for r in got}
        self.assertEqual(sorted(by), ["aaa", "ccc", "ddd"])
        self.assertEqual(by["aaa"], {"sessionId": "aaa", "pid": me, "windowId": "@18", "paneId": "%18"})
        self.assertEqual(by["ccc"], {"sessionId": "ccc", "pid": me, "windowId": None, "paneId": None})
        self.assertIsNone(by["ddd"]["windowId"])


if __name__ == "__main__":
    unittest.main()
