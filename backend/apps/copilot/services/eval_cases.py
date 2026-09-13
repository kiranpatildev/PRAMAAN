"""Eval fixture data for the NL-to-Cypher copilot (slice 4).

One code-mixed eval caseload (~12 nodes / 11 edges across EN/HI/MR names),
30 questions with gold Cypher + expected node sets. Conventions:

- Entities: (node_type, value, normalized, confidence). Keys resolve at
  runtime as f"{case_id}:{node_type}:{normalized}" (case ids vary per run).
- Edges: (src_value, edge_type, dst_value, valid_from|None, confidence).
  src/dst match entity VALUES (values are unique in this fixture).
- Cases: {id, lang, category, question, gold (Cypher with $params),
  params, expect [(node_type, normalized)...], expect_edges (count only)}.
- Truncation decision (final, documented): expected sets are FULL sets;
  fixtures stay far below MAX_LIMIT (100) and the harness FAILS any case
  whose result counts reach the clamp instead of guessing about cut rows.
- Temporal Hindi/Marathi cases use CONCRETE ISO dates: relative-date
  resolution is English-only (stated limitation), so relative phrases in
  HI/MR would be unfair test items. The one relative case is English and
  computes its expectation from resolve_temporal() at runtime.
- "Gold" Cypher is the reference translation the verifier must accept; the
  live run compares NODE SETS (order-free), never query text.
"""
from __future__ import annotations

# Coherence rule (mirrors normalize_value): value and normalized share a
# script. Latin display forms normalize Latin; Devanagari display forms
# normalize Devanagari. Mixed-script value/normalized pairs cannot arise
# from the real pipeline and are banned here — an earlier revision had
# Latin values with Devanagari keys and every native value-match failed.
EVAL_ENTITIES = [
    ("Person", "Rahul Sharma", "rahul sharma", 0.90),
    ("Person", "Vikram Patil", "vikram patil", 0.85),
    ("Person", "प्रिया देशमुख", "प्रिया देशमुख", 0.92),
    ("Person", "अमित पवार", "अमित पवार", 0.88),
    ("Person", "विकास वर्मा", "विकास वर्मा", 0.87),
    ("PhoneNumber", "9876543210", "9876543210", 0.95),
    ("PhoneNumber", "9811112233", "9811112233", 0.95),
    ("Location", "Mumbai", "mumbai", 0.80),
    ("Location", "पुणे", "पुणे", 0.82),
    ("Location", "मुंबई", "मुंबई", 0.78),
    ("Vehicle", "MH12AB1234", "MH12AB1234", 0.90),
    ("Organization", "Sharma Transports", "sharma transports", 0.86),
]

EVAL_EDGES = [
    ("Rahul Sharma", "CALLED", "9876543210", "2026-03-05", 0.80),
    ("Rahul Sharma", "CALLED", "Vikram Patil", "2026-03-06", 0.75),
    ("Vikram Patil", "CALLED", "9811112233", "2026-03-10", 0.70),
    ("प्रिया देशमुख", "PRESENT_AT", "पुणे", "2026-03-08", 0.65),
    ("अमित पवार", "PRESENT_AT", "Mumbai", "2026-03-09", 0.65),
    ("Rahul Sharma", "OWNS", "MH12AB1234", None, 0.80),
    ("Vikram Patil", "EMPLOYED_BY", "Sharma Transports", None, 0.70),
    ("प्रिया देशमुख", "CALLED", "अमित पवार", "2026-03-11", 0.72),
    ("विकास वर्मा", "PRESENT_AT", "मुंबई", "2026-03-07", 0.68),
    ("Rahul Sharma", "ASSOCIATED_WITH", "विकास वर्मा", "2026-03-04", 0.55),
    ("अमित पवार", "CALLED", "9811112233", "2026-03-12", 0.74),
]


def _k(case_id, node_type, normalized):
    return f"{case_id}:{node_type}:{normalized}"


CASES = [
    # -- lookup (8) ------------------------------------------------------
    {"id": "L1", "lang": "en", "category": "lookup",
     "question": "Find the person named Rahul Sharma",
     "gold": "MATCH (p:Case:Person {value: $name}) RETURN p",
     "params": {"name": "Rahul Sharma"},
     "expect": [("Person", "rahul sharma")]},
    {"id": "L2", "lang": "en", "category": "lookup",
     "question": "Which phone is 9876543210?",
     "gold": "MATCH (p:Case:PhoneNumber {value: $phone}) RETURN p",
     "params": {"phone": "9876543210"},
     "expect": [("PhoneNumber", "9876543210")]},
    {"id": "L3", "lang": "en", "category": "lookup",
     "question": "Show vehicle MH12AB1234",
     "gold": "MATCH (v:Case:Vehicle {value: $plate}) RETURN v",
     "params": {"plate": "MH12AB1234"},
     "expect": [("Vehicle", "MH12AB1234")]},
    {"id": "L4", "lang": "en", "category": "lookup",
     "question": "Find Sharma Transports",
     "gold": "MATCH (o:Case:Organization {value: $name}) RETURN o",
     "params": {"name": "Sharma Transports"},
     "expect": [("Organization", "sharma transports")]},
    {"id": "L5", "lang": "hi", "category": "lookup",
     "question": "विकास वर्मा नाम का व्यक्ति खोजें",
     "gold": "MATCH (p:Case:Person {value: $name}) RETURN p",
     "params": {"name": "विकास वर्मा"},
     "expect": [("Person", "विकास वर्मा")]},
    {"id": "L6", "lang": "hi", "category": "lookup",
     "question": "मुंबई हब दिखाएं",
     "gold": "MATCH (l:Case:Location {normalized: $n}) RETURN l",
     "params": {"n": "मुंबई"},
     "expect": [("Location", "मुंबई")]},
    {"id": "L7", "lang": "mr", "category": "lookup",
     "question": "प्रिया देशमुख शोधा",
     "gold": "MATCH (p:Case:Person {value: $name}) RETURN p",
     "params": {"name": "प्रिया देशमुख"},
     "expect": [("Person", "प्रिया देशमुख")]},
    {"id": "L8", "lang": "mr", "category": "lookup",
     "question": "पुणे स्थान दाखवा",
     "gold": "MATCH (l:Case:Location {value: $name}) RETURN l",
     "params": {"name": "पुणे"},
     "expect": [("Location", "पुणे")]},
    # -- traversal (8) ---------------------------------------------------
    {"id": "T1", "lang": "en", "category": "traversal",
     "question": "Who called 9876543210?",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber {value: $phone}) "
              "RETURN a, r, b"),
     "params": {"phone": "9876543210"},
     "expect": [("Person", "rahul sharma"), ("PhoneNumber", "9876543210")],
     "expect_edges": 1},
    {"id": "T2", "lang": "en", "category": "traversal",
     "question": "Who owns MH12AB1234?",
     "gold": ("MATCH (a:Case:Person)-[r:OWNS]->(v:Case:Vehicle {value: $plate}) "
              "RETURN a, r, v"),
     "params": {"plate": "MH12AB1234"},
     "expect": [("Person", "rahul sharma"), ("Vehicle", "MH12AB1234")],
     "expect_edges": 1},
    {"id": "T3", "lang": "en", "category": "traversal",
     "question": "Who works for Sharma Transports?",
     "gold": ("MATCH (a:Case:Person)-[r:EMPLOYED_BY]->(o:Case:Organization {value: $org}) "
              "RETURN a, r, o"),
     "params": {"org": "Sharma Transports"},
     "expect": [("Person", "vikram patil"), ("Organization", "sharma transports")],
     "expect_edges": 1},
    {"id": "T4", "lang": "en", "category": "traversal",
     "question": "Who was seen in Mumbai?",
     "gold": ("MATCH (a:Case:Person)-[r:PRESENT_AT]->(l:Case:Location {value: $loc}) "
              "RETURN a, r, l"),
     "params": {"loc": "Mumbai"},
     "expect": [("Person", "अमित पवार"), ("Location", "mumbai")],
     "expect_edges": 1},
    {"id": "T5", "lang": "hi", "category": "traversal",
     "question": "9876543210 पर किसने कॉल किया?",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber {value: $phone}) "
              "RETURN a, r, b"),
     "params": {"phone": "9876543210"},
     "expect": [("Person", "rahul sharma"), ("PhoneNumber", "9876543210")],
     "expect_edges": 1},
    {"id": "T6", "lang": "hi", "category": "traversal",
     "question": "विकास वर्मा कहाँ देखा गया?",
     "gold": ("MATCH (a:Case:Person {value: $name})-[r:PRESENT_AT]->(l:Case:Location) "
              "RETURN a, r, l"),
     "params": {"name": "विकास वर्मा"},
     "expect": [("Person", "विकास वर्मा"), ("Location", "मुंबई")],
     "expect_edges": 1},
    {"id": "T7", "lang": "mr", "category": "traversal",
     "question": "प्रिया देशमुख यांनी कोणाला कॉल केला?",
     "gold": ("MATCH (a:Case:Person {value: $name})-[r:CALLED]->(b:Case:Person) "
              "RETURN a, r, b"),
     "params": {"name": "प्रिया देशमुख"},
     "expect": [("Person", "प्रिया देशमुख"), ("Person", "अमित पवार")],
     "expect_edges": 1},
    {"id": "T8", "lang": "mr", "category": "traversal",
     "question": "9811112233 वर कोणी कॉल केला?",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber {value: $phone}) "
              "RETURN a, r, b"),
     "params": {"phone": "9811112233"},
     "expect": [("Person", "vikram patil"), ("Person", "अमित पवार"),
                ("PhoneNumber", "9811112233")],
     "expect_edges": 2},
    # -- temporal, concrete dates (5) ------------------------------------
    {"id": "D1", "lang": "en", "category": "temporal",
     "question": "Calls between 2026-03-05 and 2026-03-06",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case) "
              "WHERE r.valid_from >= $date_from AND r.valid_from <= $date_to "
              "RETURN a, r, b"),
     "params": {"date_from": "2026-03-05", "date_to": "2026-03-06"},
     "expect": [("Person", "rahul sharma"), ("PhoneNumber", "9876543210"),
                ("Person", "vikram patil")],
     "expect_edges": 2},
    {"id": "D2", "lang": "en", "category": "temporal",
     "question": "Who was seen anywhere on 2026-03-09?",
     "gold": ("MATCH (a:Case:Person)-[r:PRESENT_AT]->(l:Case:Location) "
              "WHERE r.valid_from >= $date_from AND r.valid_from <= $date_to "
              "RETURN a, r, l"),
     "params": {"date_from": "2026-03-09", "date_to": "2026-03-09"},
     "expect": [("Person", "अमित पवार"), ("Location", "mumbai")],
     "expect_edges": 1},
    {"id": "D3", "lang": "en", "category": "temporal",
     "question": "Links on or after 2026-03-11",
     "gold": ("MATCH (a:Case)-[r]->(b:Case) "
              "WHERE r.valid_from >= $date_from RETURN a, r, b"),
     "params": {"date_from": "2026-03-11"},
     "expect": [("Person", "प्रिया देशमुख"), ("Person", "अमित पवार"),
                ("PhoneNumber", "9811112233")],
     "expect_edges": 2},
    {"id": "D4", "lang": "hi", "category": "temporal",
     "question": "12 मार्च 2026 को किसने कॉल किया?",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case) "
              "WHERE r.valid_from >= $date_from AND r.valid_from <= $date_to "
              "RETURN a, r, b"),
     "params": {"date_from": "2026-03-12", "date_to": "2026-03-12"},
     "expect": [("Person", "अमित पवार"), ("PhoneNumber", "9811112233")],
     "expect_edges": 1},
    {"id": "D5", "lang": "mr", "category": "temporal",
     "question": "8 मार्च 2026 रोजी कोण कुठे होते?",
     "gold": ("MATCH (a:Case:Person)-[r:PRESENT_AT]->(l:Case:Location) "
              "WHERE r.valid_from >= $date_from AND r.valid_from <= $date_to "
              "RETURN a, r, l"),
     "params": {"date_from": "2026-03-08", "date_to": "2026-03-08"},
     "expect": [("Person", "प्रिया देशमुख"), ("Location", "पुणे")],
     "expect_edges": 1},
    # -- temporal, relative phrase (1; expectation computed at runtime) ---
    {"id": "D6", "lang": "en", "category": "temporal-relative",
     "question": "Calls last week",
     "gold": None,  # resolved at runtime; the model must use $date_from/$date_to
     "params": {},
     "expect_relative": True},
    # -- multi-hop fixed chains (4) --------------------------------------
    {"id": "M1", "lang": "en", "category": "multihop",
     "question": "Who called someone who was seen in Mumbai?",
     "gold": ("MATCH (a:Case:Person)-[r1:CALLED]->(b:Case:Person)"
              "-[r2:PRESENT_AT]->(l:Case:Location {value: $loc}) "
              "RETURN a, r1, b, r2, l"),
     "params": {"loc": "Mumbai"},
     "expect": [("Person", "प्रिया देशमुख"), ("Person", "अमित पवार"),
                ("Location", "mumbai")],
     "expect_edges": 2},
    {"id": "M2", "lang": "en", "category": "multihop",
     "question": "Phones called by people who own MH12AB1234",
     "gold": ("MATCH (a:Case:Person)-[r1:OWNS]->(v:Case:Vehicle {value: $plate}), "
              "(a)-[r2:CALLED]->(p:Case:PhoneNumber) RETURN a, r1, v, r2, p"),
     "params": {"plate": "MH12AB1234"},
     "expect": [("Person", "rahul sharma"), ("Vehicle", "MH12AB1234"),
                ("PhoneNumber", "9876543210")],
     "expect_edges": 2},
    {"id": "M3", "lang": "hi", "category": "multihop",
     "question": "राहुल शर्मा ने जिसे कॉल किया उसने किसे कॉल किया?",
     "gold": ("MATCH (a:Case:Person {value: $name})-[r1:CALLED]->(b:Case:Person)"
              "-[r2:CALLED]->(p:Case:PhoneNumber) RETURN a, r1, b, r2, p"),
     "params": {"name": "Rahul Sharma"},
     "expect": [("Person", "rahul sharma"), ("Person", "vikram patil"),
                ("PhoneNumber", "9811112233")],
     "expect_edges": 2},
    {"id": "M4", "lang": "mr", "category": "multihop",
     "question": "अमित पवार यांनी कॉल केलेला नंबर कोणी वापरला?",
     "gold": ("MATCH (a:Case:Person {value: $name})-[r1:CALLED]->(p:Case:PhoneNumber), "
              "(b:Case:Person)-[r2:CALLED]->(p) RETURN a, r1, p, r2, b"),
     "params": {"name": "अमित पवार"},
     "expect": [("Person", "अमित पवार"), ("PhoneNumber", "9811112233"),
                ("Person", "vikram patil")],
     "expect_edges": 2},
    # -- aggregation (2) ---------------------------------------------------
    {"id": "G1", "lang": "en", "category": "aggregation",
     "question": "How many vehicles does each person own?",
     "gold": ("MATCH (p:Case:Person)-[r:OWNS]->(v:Case:Vehicle) "
              "RETURN p, collect(v) AS vehicles"),
     "params": {},
     "expect": [("Person", "rahul sharma"), ("Vehicle", "MH12AB1234")]},
    {"id": "G2", "lang": "en", "category": "aggregation",
     "question": "Count calls per caller",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case) "
              "RETURN a, b, collect(r) AS rels, a.value AS caller, "
              "count(r) AS calls ORDER BY calls DESC"),
     "params": {},
     "expect": [("Person", "rahul sharma"), ("PhoneNumber", "9876543210"),
                ("Person", "vikram patil"), ("PhoneNumber", "9811112233"),
                ("Person", "प्रिया देशमुख"), ("Person", "अमित पवार")],
     "expect_edges": 5},
    # -- script-mixed lookup (2) -------------------------------------------
    {"id": "X1", "lang": "hi", "category": "lookup",
     "question": "9876543210 नंबर किसने कॉल किया था?",
     "gold": ("MATCH (a:Case:Person)-[r:CALLED]->(b:Case:PhoneNumber {value: $phone}) "
              "RETURN a, r, b"),
     "params": {"phone": "9876543210"},
     "expect": [("Person", "rahul sharma"), ("PhoneNumber", "9876543210")],
     "expect_edges": 1},
    {"id": "X2", "lang": "mr", "category": "lookup",
     "question": "MH12AB1234 गाडी कोणाची आहे?",
     "gold": ("MATCH (a:Case:Person)-[r:OWNS]->(v:Case:Vehicle {value: $plate}) "
              "RETURN a, r, v"),
     "params": {"plate": "MH12AB1234"},
     "expect": [("Person", "rahul sharma"), ("Vehicle", "MH12AB1234")],
     "expect_edges": 1},
]


def expected_keys(case_id: int, entries) -> set[str]:
    return {_k(case_id, t, n) for (t, n) in entries}
