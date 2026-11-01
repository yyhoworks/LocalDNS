import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("traffic_collector.py"))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
NOW = dt.datetime(2026, 11, 1, 13, 30, tzinfo=dt.timezone(dt.timedelta(hours=8)))


def connection(down=100, up=20, identifier="a", node="node", provider="provider", ip="192.168.8.102"):
    return {"id": identifier, "download": down, "upload": up, "chains": [node], "providerChains": [provider], "metadata": {"sourceIP": ip}}


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state.json"
        self.state = collector.load_state(self.path, NOW)

    def tearDown(self):
        self.temp.cleanup()

    def sample(self, connections, offset=0):
        return collector.sample({"connections": connections}, self.state, NOW + dt.timedelta(seconds=offset))

    def test_initial_snapshot_is_a_baseline_then_only_proxy_deltas_are_added(self):
        self.sample([connection(), connection(identifier="direct", node="DIRECT")])
        self.assertEqual(self.state["total"], {"down": 0, "up": 0})
        self.sample([connection(180, 35), connection(900, 800, identifier="direct", node="DIRECT")], 5)
        self.assertEqual(self.state["total"], {"down": 80, "up": 15})
        bucket = self.state["daily"]["2026-11-01"]
        for dimension, key in [("devices", "192.168.8.102"), ("providers", "provider"), ("nodes", "node")]:
            self.assertEqual(bucket[dimension][key], self.state["total"])
        self.assertEqual(bucket["hourly"]["13"], self.state["total"])

    def test_new_connections_and_counter_resets(self):
        self.sample([])
        self.sample([connection(120, 40)], 5)
        self.sample([connection(7, 2)], 10)
        self.assertEqual(self.state["total"], {"down": 127, "up": 42})

    def test_closed_connections_do_not_invent_unseen_tail_bytes(self):
        self.sample([])
        self.sample([connection(100)], 5)
        self.sample([], 10)
        self.assertEqual(self.state["total"]["down"], 100)
        self.assertEqual(self.state["seen"], {})

    def test_legacy_migration_preserves_totals_and_counter_baselines(self):
        self.path.write_text(json.dumps({"seen": {"a": {"down": 100, "up": 20}}, "daily": {"2026-11-01": {"down": 300, "up": 40}}, "since": "2026-11-01"}))
        self.state = collector.load_state(self.path, NOW)
        self.sample([connection(120, 30)], 5)
        self.assertEqual(self.state["total"], {"down": 320, "up": 50})
        self.assertEqual(self.state["daily"]["2026-11-01"]["coverage"], "unknown")
        self.assertEqual(self.state["daily"]["2026-11-01"]["devices"]["192.168.8.102"]["down"], 20)

    def test_lifetime_survives_daily_retention(self):
        self.state["daily"] = {(NOW.date() - dt.timedelta(days=i)).isoformat(): {"down": 1, "up": 0} for i in range(401)}
        self.state["total"] = {"down": 401, "up": 0}
        self.sample([])
        self.assertEqual(len(self.state["daily"]), 400)
        self.assertEqual(self.state["total"]["down"], 401)

    def test_missing_days_are_absent_and_gaps_mark_partial(self):
        self.sample([])
        self.sample([], 120)
        summary, detail = collector.publications(self.state)
        self.assertIsNone(summary["yesterday"])
        self.assertEqual(len(detail["daily"]), 1)
        self.assertEqual(detail["daily"][0]["gaps"], 1)
        self.assertEqual(detail["daily"][0]["coverage"], "partial")

    def test_midnight_uses_server_date_and_retains_previous_day(self):
        self.sample([])
        collector.sample({"connections": [connection(50, 10)]}, self.state, NOW.replace(day=2, hour=0, minute=0, second=2))
        summary, _ = collector.publications(self.state)
        self.assertEqual(summary["date"], "2026-11-02")
        self.assertEqual(summary["utc_offset_minutes"], 480)
        self.assertEqual(summary["yesterday"], {"down": 0, "up": 0})

    def test_invalid_snapshot_does_not_partially_mutate_state(self):
        self.sample([])
        before = copy.deepcopy(self.state)
        with self.assertRaises(ValueError):
            self.sample([connection(100), connection("invalid", identifier="b")], 5)
        self.assertEqual(self.state, before)

    def test_corrupt_state_is_not_silently_reset(self):
        self.path.write_text("{invalid")
        with self.assertRaises(ValueError):
            collector.load_state(self.path, NOW)

    def test_dimensions_are_bounded_without_discarding_their_sum(self):
        bucket = {}
        for i in range(collector.MAX_KEYS + 10):
            collector.record_dimension(bucket, "devices", str(i), {"down": 1, "up": 2})
        self.assertLessEqual(len(bucket["devices"]), collector.MAX_KEYS + 1)
        self.assertEqual(sum(v["down"] for v in bucket["devices"].values()), collector.MAX_KEYS + 10)

    def test_atomic_publications_preserve_state_and_separate_detail(self):
        self.sample([])
        out, detail = self.path.with_name("traffic.json"), self.path.with_name("traffic-detail.json")
        collector.publish(self.state, self.path, out, detail, "missing", "mihomo", 5, 30)
        self.assertNotIn("daily", json.loads(out.read_text()))
        self.assertIn("daily", json.loads(detail.read_text()))
        self.assertEqual(collector.load_state(self.path)["total"], self.state["total"])

    def test_config_comments_quotes_and_wildcard(self):
        path = self.path.with_name("config.yaml")
        path.write_text('external-controller: "0.0.0.0:9090" # local\nsecret: "fixture#value"\n')
        self.assertEqual(collector.read_controller_from_config(path), ("http://127.0.0.1:9090", "fixture#value"))


if __name__ == "__main__":
    unittest.main()
