import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "hooks", "list_verticals.py")


def vertical(sid, parent, status, created, **extra):
    return {"slug": "s-" + sid, "title": "T " + sid, "status": status, "sessionId": sid, "parentSessionId": parent, "createdAt": created, **extra}


class ListVerticals(unittest.TestCase):
    def run_on(self, files, parent):
        with tempfile.TemporaryDirectory() as d:
            for name, data in files.items():
                with open(os.path.join(d, name), "w") as f:
                    json.dump(data, f)
            out = subprocess.run([sys.executable, "-I", SCRIPT, d, parent], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_only_children_of_the_parent_active_first(self):
        got = self.run_on(
            {
                "chat-verticali_gorlix-chat-verticali-1.json": {
                    "v:a": vertical("a", "p", "done", "2026-10-01"),
                    "v:b": vertical("b", "p", "active", "2026-10-02", contextPercent=40),
                    "v:c": vertical("c", "other", "active", "2026-10-03"),
                    "other-key": {"x": 1},
                },
                "chat-verticali_gorlix-local-2.json": {"v:d": vertical("d", "p", "active", "2026-10-04")},
            },
            "p",
        )
        self.assertEqual([r["id"] for r in got], ["b", "a"])
        self.assertEqual(got[0]["contextPercent"], 40)
        self.assertIsNone(got[1]["contextPercent"])

    def test_no_store_gives_empty_list(self):
        self.assertEqual(self.run_on({}, "p"), [])


if __name__ == "__main__":
    unittest.main()
