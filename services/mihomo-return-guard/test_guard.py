"""Safety regressions using a sanitized snapshot of the working VM design."""
import contextlib
import copy
import json
import pathlib
import unittest
from unittest import mock

import guard


class GuardTests(unittest.TestCase):
    def setUp(self):
        fixture = json.loads(pathlib.Path(__file__).with_name("healthy.example.json").read_text())
        self.state, self.config = fixture["state"], fixture["config"]

    def assess(self):
        return guard.assess(self.state, self.config)

    def ensure(self, states):
        with mock.patch.object(guard, "snapshot", side_effect=states), \
             mock.patch.object(guard, "configuration", return_value=self.config), \
             mock.patch.object(guard, "repair_lock", return_value=contextlib.nullcontext()), \
             mock.patch.object(guard, "command") as mutate:
            result = guard.ensure()
        return result, mutate

    def test_healthy_state_does_not_mutate_any_rules(self):
        result, mutate = self.ensure([self.state])
        self.assertTrue(result["ok"])
        self.assertEqual(result["repaired"], [])
        mutate.assert_not_called()

    def test_missing_core_chain_never_recreates_interception(self):
        del self.state["v4"]["mangle"]["mihomo_output"]
        result, mutate = self.ensure([self.state])
        self.assertFalse(result["ok"])
        self.assertFalse(result["before"]["ready"])
        mutate.assert_not_called()

    def test_stopped_core_is_not_restarted(self):
        self.state["running"] = False
        result, mutate = self.ensure([self.state])
        self.assertFalse(result["ok"])
        mutate.assert_not_called()

    def test_incomplete_reload_waits_without_mutating(self):
        pre = self.state["v4"]["mangle"]["mihomo_prerouting"]
        pre[:] = [rule for rule in pre if not (guard.target(rule) == "TPROXY" and rule[:2] == ["-p", "udp"])]
        result, mutate = self.ensure([self.state])
        self.assertFalse(result["before"]["ready"])
        mutate.assert_not_called()

    def test_missing_output_hook_is_not_invented(self):
        self.state["v4"]["mangle"]["OUTPUT"] = []
        result, mutate = self.ensure([self.state])
        self.assertFalse(result["before"]["ready"])
        mutate.assert_not_called()

    def test_real_failure_pattern_only_repairs_ipv4(self):
        good = copy.deepcopy(self.state)
        mangle = self.state["v4"]["mangle"]
        mangle["mihomo_prerouting"] = [rule for rule in mangle["mihomo_prerouting"] if guard.target(rule) != "CONNMARK"]
        mangle["mihomo_output"] = [rule for rule in mangle["mihomo_output"] if "connmark" not in rule]
        for protocol in ("tcp", "udp"):
            mangle["mihomo_output"].append(["-p", protocol, "-j", "MARK", "--set-xmark", "0x2d0/0xffffffff"])
        self.state["v4"]["nat"]["POSTROUTING"] = [rule for rule in self.state["v4"]["nat"]["POSTROUTING"] if "connmark" not in rule]
        result, mutate = self.ensure([self.state, good])
        self.assertTrue(result["ok"])
        self.assertEqual(result["repaired"], ["ipv4"])
        self.assertEqual(len(result["before"]["ipv4"]), 6)
        self.assertEqual(result["before"]["ipv6"], [])
        self.assertEqual(mutate.call_count, 1)
        self.assertIn("apply_rules", mutate.call_args.args[0][-1])

    def test_mark_after_tproxy_is_rejected(self):
        rules = self.state["v4"]["mangle"]["mihomo_prerouting"]
        mark = next(rule for rule in rules if rule[:2] == ["-p", "udp"] and guard.target(rule) == "CONNMARK")
        rules.remove(mark)
        rules.append(mark)
        self.assertIn("udp connection mark missing or misplaced", self.assess()["ipv4"])

    def test_nat_exemption_after_masquerade_is_rejected(self):
        rules = self.state["v4"]["nat"]["POSTROUTING"]
        rules.insert(0, ["-j", "MASQUERADE"])
        self.assertIn("marked response NAT exemption missing or misplaced", self.assess()["ipv4"])

    def test_missing_return_routes_are_detected(self):
        self.state["route4"] = ""
        self.state["route6"] = ""
        result = self.assess()
        self.assertEqual(len(result["ipv4"]), 2)
        self.assertIn("IPv6 return route missing", result["ipv6"])

    def test_ipv6_ingress_loss_only_rebuilds_ipv6(self):
        good = copy.deepcopy(self.state)
        self.state["v6"]["mangle"]["mihomo6_pre"] = []
        result, mutate = self.ensure([self.state, good])
        self.assertTrue(result["ok"])
        self.assertEqual(result["repaired"], ["ipv6"])
        mutate.assert_called_once_with(["/usr/local/sbin/mihomo-ipv6", "up"])

    def test_unsuccessful_recovery_is_not_reported_as_healthy(self):
        self.state["route4"] = ""
        result, _ = self.ensure([self.state, self.state])
        self.assertFalse(result["ok"])

    def test_table_parser_ignores_counters_and_comments(self):
        value = "# before\n*mangle\n:mihomo_output - [23:123]\n-A mihomo_output -p udp -j RETURN\nCOMMIT\n"
        self.assertEqual(guard.parse_tables(value), {"mangle": {"mihomo_output": [["-p", "udp", "-j", "RETURN"]]}})

    def test_absent_route_table_can_be_recovered(self):
        missing = mock.Mock(returncode=2, stderr="Error: ipv4: FIB table does not exist.\n", stdout="")
        with mock.patch.object(guard.subprocess, "run", return_value=missing):
            self.assertEqual(guard.routing_table("-4", 104), "")


if __name__ == "__main__":
    unittest.main()
