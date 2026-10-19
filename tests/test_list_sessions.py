"""Run: python3 -I tests/test_list_sessions.py  (plugin test only runs *.test.ts)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks", "list_sessions.py")


def user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def tool_use(name, inp):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": inp}]}}


def result(text):
    return {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": text}]}}


class ListSessions(unittest.TestCase):
    def run_on(self, sessions, *extra):
        with tempfile.TemporaryDirectory() as d:
            for sid, rows in sessions.items():
                with open(os.path.join(d, sid + ".jsonl"), "w") as f:
                    f.write("\n".join(json.dumps(r) for r in rows) + "\n")
            out = subprocess.run([sys.executable, "-I", SCRIPT, d, "none", *extra], capture_output=True, text=True, check=True)
        return {r["id"]: r for r in json.loads(out.stdout)}

    def test_latest_ref_with_prefix_only(self):
        got = self.run_on(
            {
                "a": [user("lavora su ACME-3 e ADR-010"), tool_use("mcp__paca__update_task", {"taskId": "x", "title": "ACME-7"}), result("ACME-99 UTF-8")],
                "b": [user("solo ADR-010 e UTF-8")],
                "c": [tool_use("mcp__paca__get_task_by_number", {"projectId": "p", "taskNumber": 12}), {"type": "custom-title", "customTitle": "Titolo"}],
                "d": [user("ACME-1"), user("poi ACME-2 e ACME-5 ultimo")],
            },
            "--prefix",
            "ACME",
        )
        self.assertEqual(got["a"]["pacaRef"], "ACME-7")
        self.assertIsNone(got["b"]["pacaRef"])
        self.assertEqual(got["c"]["pacaRef"], "ACME-12")
        self.assertEqual(got["c"]["title"], "Titolo")
        self.assertEqual(got["d"]["pacaRef"], "ACME-5")

    def test_no_prefix_gives_null(self):
        self.assertIsNone(self.run_on({"a": [user("ACME-3")]})["a"]["pacaRef"])


if __name__ == "__main__":
    unittest.main()
