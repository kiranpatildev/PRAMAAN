"""Anomaly confidence badges are real functions of measured quantities."""
from django.test import TestCase

from apps.analytics.services.anomalies import detect


class AnomalyConfidenceTests(TestCase):
    def test_hub_confidence_grows_with_z(self):
        mild = {f"k:{i}": {"label": f"N{i}", "degree": 1} for i in range(8)}
        mild["hub"] = {"label": "Hub", "degree": 6}
        wild = {f"k:{i}": {"label": f"N{i}", "degree": 1} for i in range(20)}
        wild["hub"] = {"label": "Hub", "degree": 30}
        cm = next(a for a in detect(mild, []) if a["kind"] == "hub_outlier")["confidence"]
        cw = next(a for a in detect(wild, []) if a["kind"] == "hub_outlier")["confidence"]
        self.assertGreaterEqual(cm, 0.60)
        self.assertGreater(cw, cm)
        self.assertLessEqual(cw, 0.95)

    def test_burst_confidence_grows_with_size(self):
        nodes = {"k:a": {"label": "A"}}
        edges = [{"id": f"e{i}", "source": "k:a", "target": f"k:{i}",
                  "valid_from": "2026-03-15", "snippet": "s", "confidence": 0.8} for i in range(5)]
        found = [a for a in detect(nodes, edges) if a["kind"] == "contact_burst"]
        self.assertEqual(len(found), 1)
        self.assertGreaterEqual(found[0]["confidence"], 0.70)

    def test_weak_community_confidence_inverts_mean(self):
        edges = [{"id": "e1", "source": "k:a", "target": "k:b", "confidence": 0.2, "snippet": ""},
                 {"id": "e2", "source": "k:b", "target": "k:c", "confidence": 0.2, "snippet": ""}]
        comms = [{"id": "louvain-1", "members": ["k:a", "k:b", "k:c"]}]
        found = [a for a in detect({}, edges, comms) if a["kind"] == "weak_evidence_community"]
        self.assertEqual(len(found), 1)
        self.assertGreaterEqual(found[0]["confidence"], 0.55)
