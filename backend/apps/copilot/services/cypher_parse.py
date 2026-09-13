"""Restricted-Cypher grammar parser for the NL-to-Cypher verifier gate.

This is a REAL parser (tokenizer + recursive descent producing an AST),
not regex matching. It accepts exactly the read-only subset the verifier
allows — anything outside the grammar is a syntax error, which the verifier
turns into an "I can't express that yet" answer:

  query    := MATCH pattern [, pattern]* [WHERE expr] RETURN ret [, ret]*
              [ORDER BY ord [, ord]*] [LIMIT int|$param]
  pattern  := node (edge node)*              -- fixed chains only, single MATCH
  node     := "(" [alias] [":" label (":" label)*] [props] ")"
  edge     := "-[" [alias] [":" t ("|" t)*] [props] "]-" dir
            | "--" | "-->" | "<--"            -- anonymous untyped hops
  expr     := boolean combination of comparisons, IN, IS [NOT] NULL,
              STARTS WITH / ENDS WITH / CONTAINS, =~, function calls
  ret/ord  := "*" | expr [AS alias]  (ord adds ASC/DESC)

Deliberately OUT (rejected): variable-length `[*..]` paths, OPTIONAL,
WITH, UNION, SKIP, shortestPath(), procedure CALLs, multiple statements.
Each exclusion keeps server-side case-scope injection total: every MATCH
node must carry an alias AND the :Case label, so the injector can pin
`alias.case_id IN $case_ids` on every endpoint. Multi-hop questions are
expressed as explicit fixed chains (few-shot examples show how).
"""
from __future__ import annotations

from dataclasses import dataclass, field


class CypherInvalid(Exception):
    """Raised for any input outside the restricted grammar."""


KEYWORDS = frozenset({
    "MATCH", "WHERE", "RETURN", "ORDER", "BY", "LIMIT", "AS", "ASC", "DESC",
    "AND", "OR", "NOT", "IN", "IS", "NULL", "TRUE", "FALSE",
    "STARTS", "ENDS", "CONTAINS",
})

# Pure scalar functions only — no procedures, no graph-writing helpers,
# no access to anything but the value passed in.
ALLOWED_FUNCTIONS = frozenset({
    "count", "collect", "size", "length", "coalesce",
    "tolower", "toupper", "trim", "split", "substring", "replace",
    "date", "datetime", "duration",
    "labels", "type", "keys", "properties",
    "head", "last", "tail", "range",
    "abs", "round", "floor", "ceil", "sign",
    "tostring", "tointeger", "tofloat", "toboolean",
    "startnode", "endnode", "id", "elementid",
})


@dataclass
class Token:
    kind: str  # IDENT KEYWORD INT FLOAT STRING PARAM OP PUNCT EOF
    text: str
    pos: int


def tokenize(cypher: str) -> list[Token]:
    """Split Cypher into typed tokens. Raises CypherInvalid on bad input."""
    toks: list[Token] = []
    i, n = 0, len(cypher or "")
    while i < n:
        c = cypher[i]
        if c.isspace():
            i += 1
            continue
        if c == "/" and i + 1 < n and cypher[i + 1] == "/":
            while i < n and cypher[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and cypher[i + 1] == "*":
            j = cypher.find("*/", i + 2)
            if j < 0:
                raise CypherInvalid("unterminated comment")
            i = j + 2
            continue
        if c in ("'", '"', "`"):
            j = i + 1
            buf = []
            while j < n:
                if cypher[j] == "\\" and j + 1 < n:
                    buf.append(cypher[j + 1])
                    j += 2
                    continue
                if cypher[j] == c:
                    break
                buf.append(cypher[j])
                j += 1
            if j >= n:
                raise CypherInvalid("unterminated string literal")
            toks.append(Token("STRING", "".join(buf), i))
            i = j + 1
            continue
        if c == "$":
            j = i + 1
            if j < n and cypher[j] == "`":
                k = cypher.find("`", j + 1)
                if k < 0:
                    raise CypherInvalid("unterminated parameter name")
                toks.append(Token("PARAM", cypher[j + 1:k], i))
                i = k + 1
            else:
                while j < n and (cypher[j].isalnum() or cypher[j] == "_"):
                    j += 1
                if j == i + 1:
                    raise CypherInvalid("bare $ is not a parameter")
                toks.append(Token("PARAM", cypher[i + 1:j], i))
                i = j
            continue
        if c.isdigit() or (c == "." and i + 1 < n and cypher[i + 1].isdigit()):
            j = i
            while j < n and (cypher[j].isdigit() or cypher[j] == "."):
                j += 1
            text = cypher[i:j]
            toks.append(Token("FLOAT" if text.count(".") else "INT", text, i))
            i = j
            continue
        if c.isalpha() or c == "_" or ord(c) > 127:
            j = i
            while j < n and (cypher[j].isalnum() or cypher[j] in ("_",) or ord(cypher[j]) > 127):
                j += 1
            word = cypher[i:j]
            toks.append(Token("KEYWORD" if word.upper() in KEYWORDS else "IDENT", word, i))
            i = j
            continue
        two = cypher[i:i + 2]
        if two in ("<>", "!=", "<=", ">=", "=~", "->", "<-"):
            toks.append(Token("OP", two, i))
            i += 2
            continue
        if c in "=<>":
            toks.append(Token("OP", c, i))
            i += 1
            continue
        if c in "(),[]{}:.*|+-/%":
            toks.append(Token("PUNCT", c, i))
            i += 1
            continue
        raise CypherInvalid(f"unexpected character {c!r}")
    toks.append(Token("EOF", "", n))
    return toks


def strip_literals(cypher: str) -> str:
    """Replace string/comment spans with spaces (same length, offsets stable).

    The banned-keyword tripwire runs on this, so words inside evidence
    strings ('Deleted files…') can never false-positive a rejection.
    """
    out = list(cypher or "")
    i, n = 0, len(out)
    while i < n:
        c = out[i]
        if c == "/" and i + 1 < n and out[i + 1] in ("*", "/"):
            end = out.index("\n", i) if out[i + 1] == "/" else None
            if end is None:
                end = "".join(out).find("*/", i + 2)
                end = n if end < 0 else end + 2
            for k in range(i, min(end, n)):
                out[k] = " "
            i = end
            continue
        if c in ("'", '"', "`"):
            out[i] = " "
            i += 1
            while i < n:
                if out[i] == "\\" and i + 1 < n:
                    out[i] = out[i + 1] = " "
                    i += 2
                    continue
                if out[i] == c:
                    out[i] = " "
                    i += 1
                    break
                out[i] = " "
                i += 1
            continue
        i += 1
    return "".join(out)


@dataclass
class NodePattern:
    alias: str
    labels: list[str]
    props: dict
    span: tuple[int, int]


@dataclass
class RelPattern:
    alias: str
    types: list[str]
    props: dict
    directed: str  # "->" | "<-" | "-"


@dataclass
class ParsedQuery:
    node_aliases: list[str]
    node_labels: dict[str, list[str]]  # alias -> labels
    rel_aliases: list[str]
    rel_types: dict[str, list[str]]  # alias -> types ("" key for anonymous)
    match_end: int  # token index where MATCH clause ends
    where_at: int | None  # token index of WHERE, if present
    where_end: int  # token index where WHERE clause ends (= return_at)
    return_at: int
    has_limit: bool
    tokens: list[Token] = field(repr=False)


class _Parser:
    def __init__(self, tokens: list[Token]):
        self.t = tokens
        self.i = 0

    def peek(self) -> Token:
        return self.t[self.i]

    def next(self) -> Token:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expect(self, kind: str, text: str | None = None) -> Token:
        tok = self.next()
        if tok.kind != kind or (text is not None and tok.text.upper() != text.upper()):
            raise CypherInvalid(f"expected {text or kind} near {tok.text!r}")
        return tok

    def at_kw(self, *words: str) -> bool:
        tok = self.peek()
        return tok.kind == "KEYWORD" and tok.text.upper() in words

    def at_punct(self, ch: str) -> bool:
        tok = self.peek()
        return tok.kind == "PUNCT" and tok.text == ch

    def parse(self) -> ParsedQuery:
        self.expect("KEYWORD", "MATCH")
        nodes: list[NodePattern] = []
        rels: list[RelPattern] = []
        anon_rel = 0
        while True:
            nodes.append(self.parse_node())
            while self.at_punct("-") or (self.peek().kind == "OP" and self.peek().text == "<-"):
                rels.append(self.parse_rel(anon_rel))
                if rels[-1].alias == "":
                    anon_rel += 1
                nodes.append(self.parse_node())
            if self.at_punct(","):
                self.next()
                continue
            break
        match_end = self.i
        where_at = None
        if self.at_kw("WHERE"):
            where_at = self.i
            self.next()
            self.parse_or()
        where_end = self.i
        self.expect("KEYWORD", "RETURN")
        return_at = self.i - 1
        self.parse_return_list(top=True)
        if self.at_kw("ORDER"):
            self.next()
            self.expect("KEYWORD", "BY")
            while True:
                self.parse_or()
                if self.at_kw("ASC", "DESC"):
                    self.next()
                if self.at_punct(","):
                    self.next()
                    continue
                break
        has_limit = False
        if self.at_kw("LIMIT"):
            self.next()
            tok = self.next()
            if tok.kind not in ("INT", "PARAM"):
                raise CypherInvalid("LIMIT takes an integer or parameter")
            has_limit = True
        if self.peek().kind != "EOF":
            raise CypherInvalid(f"unexpected {self.peek().text!r} after query end")
        label_first: dict[str, list[str]] = {}
        for nd in nodes:
            # First binding wins: a bare re-mention `(a)` later must not
            # erase the labels from `(a:Case:Person)` earlier.
            label_first.setdefault(nd.alias, nd.labels)
        return ParsedQuery(
            node_aliases=[nd.alias for nd in nodes],
            node_labels=label_first,
            rel_aliases=[r.alias for r in rels if r.alias],
            rel_types={(r.alias or f"#{k}"): r.types for k, r in enumerate(rels)},
            match_end=match_end, where_at=where_at, where_end=where_end,
            return_at=return_at, has_limit=has_limit, tokens=self.t,
        )

    def parse_node(self) -> NodePattern:
        self.expect("PUNCT", "(")
        start = self.i
        alias, labels, props = "", [], {}
        if self.peek().kind == "IDENT":
            alias = self.next().text
        while self.at_punct(":"):
            self.next()
            tok = self.next()
            if tok.kind not in ("IDENT", "KEYWORD"):
                raise CypherInvalid("expected a label after :")
            labels.append(tok.text)
        if self.at_punct("{"):
            props = self.parse_map()
        self.expect("PUNCT", ")")
        return NodePattern(alias, labels, props, (start, self.i))

    def _peek_at(self, k: int) -> Token:
        j = self.i + k
        if j >= len(self.t):
            return Token("EOF", "", -1)
        return self.t[j]

    def parse_rel(self, anon_n: int) -> RelPattern:
        if self.peek().kind == "OP" and self.peek().text == "<-":
            self.next()
            self.expect("PUNCT", "-")
            return RelPattern("", [], {}, "<-")
        # Bracket form "-[...]" (the "-" here is always a lone dash: "->"
        # tokenizes as one OP, so a "[" two tokens ahead means bracket form).
        if self.at_punct("-") and self._peek_at(1).kind == "PUNCT" \
                and self._peek_at(1).text == "[":
            self.next()
            return self._parse_bracket_rel()
        # bare -- / --> : consume exactly one "-" here; a second "-" must
        # be followed by ">" (else `--(` would eat the next pattern's dash).
        self.expect("PUNCT", "-")
        tok = self.peek()
        if tok.kind == "OP" and tok.text == "->":
            self.next()
            return RelPattern("", [], {}, "->")
        if tok.kind == "PUNCT" and tok.text == "-":
            self.next()
            t2 = self.peek()
            if (t2.kind == "OP" and t2.text in (">", "->")) or (t2.kind == "PUNCT" and t2.text == ">"):
                self.next()
                return RelPattern("", [], {}, "->")
            return RelPattern("", [], {}, "-")  # plain "--", both dashes consumed
        return RelPattern("", [], {}, "-")

    def _parse_bracket_rel(self) -> RelPattern:
        self.expect("PUNCT", "[")
        alias, types, props = "", [], {}
        if self.peek().kind == "IDENT":
            # A leading name is always the rel alias ([r], [r:TYPE]).
            # Bare types start with ":" instead.
            alias = self.next().text
        while self.at_punct(":"):
            self.next()
            tok = self.next()
            if tok.kind not in ("IDENT", "KEYWORD"):
                raise CypherInvalid("expected a relationship type after :")
            types.append(tok.text)
        if self.at_punct("{"):
            props = self.parse_map()
        self.expect("PUNCT", "]")
        # Tail: "->" arrives as ONE op token; "-" + ">" as two tokens;
        # anything else (next pattern/keyword) means undirected.
        tok = self.peek()
        if tok.kind == "OP" and tok.text == "->":
            self.next()
            return RelPattern(alias, types, props, "->")
        if tok.kind == "PUNCT" and tok.text == "-":
            self.next()
            return RelPattern(alias, types, props, self._arrow_tail())
        return RelPattern(alias, types, props, "-")

    def _arrow_tail(self) -> str:
        """Direction after a bracketed `-[...]-`: `>`/`)`… — `(`-lookahead
        means undirected (the next pattern starts)."""
        tok = self.peek()
        if (tok.kind == "OP" and tok.text == ">") or (tok.kind == "PUNCT" and tok.text == ">"):
            self.next()
            return "->"
        return "-"

    def parse_map(self) -> dict:
        self.expect("PUNCT", "{")
        out = {}
        if not self.at_punct("}"):
            while True:
                k = self.next()
                if k.kind not in ("IDENT", "KEYWORD"):
                    raise CypherInvalid("expected a property name in map")
                self.expect_punct_colon()
                out[k.text] = self.parse_value()
                if self.at_punct(","):
                    self.next()
                    continue
                break
        self.expect("PUNCT", "}")
        return out

    def expect_punct_colon(self):
        tok = self.next()
        if not ((tok.kind == "PUNCT" and tok.text == ":") or (tok.kind == "OP" and tok.text == ":")):
            raise CypherInvalid("expected : in map")

    def parse_value(self):
        tok = self.peek()
        if tok.kind in ("STRING", "INT", "FLOAT", "PARAM"):
            return self.next().text
        if tok.kind == "KEYWORD" and tok.text.upper() in ("TRUE", "FALSE", "NULL"):
            return self.next().text.upper()
        if tok.kind == "PUNCT" and tok.text == "[":
            self.next()
            items = []
            if not self.at_punct("]"):
                while True:
                    items.append(self.parse_value())
                    if self.at_punct(","):
                        self.next()
                        continue
                    break
            self.expect("PUNCT", "]")
            return items
        if tok.kind == "PUNCT" and tok.text == "{":
            return self.parse_map()
        if (tok.kind == "PUNCT" and tok.text in ("-", "+")) or tok.kind == "OP":
            sign = self.next().text
            num = self.next()
            if num.kind not in ("INT", "FLOAT"):
                raise CypherInvalid("expected a number after sign")
            return sign + num.text
        raise CypherInvalid(f"unexpected value {tok.text!r}")

    # -- expressions (WHERE / RETURN / ORDER BY) -------------------------
    def parse_return_list(self, top=False):
        while True:
            if self.at_punct("*"):
                self.next()
            else:
                self.parse_or()
                if self.at_kw("AS"):
                    self.next()
                    tok = self.next()
                    if tok.kind not in ("IDENT", "KEYWORD"):
                        raise CypherInvalid("expected an alias after AS")
            if self.at_punct(","):
                self.next()
                continue
            break

    def parse_or(self):
        self.parse_and()
        while self.at_kw("OR"):
            self.next()
            self.parse_and()

    def parse_and(self):
        self.parse_not()
        while self.at_kw("AND"):
            self.next()
            self.parse_not()

    def parse_not(self):
        if self.at_kw("NOT"):
            self.next()
            self.parse_not()
            return
        self.parse_predicate()

    def parse_predicate(self):
        self.parse_add()
        tok = self.peek()
        if tok.kind == "OP" and tok.text in ("=", "<>", "!=", "<", "<=", ">", ">=", "=~"):
            self.next()
            self.parse_add()
            return
        if tok.kind == "KEYWORD" and tok.text.upper() == "IN":
            self.next()
            if self.peek().kind == "PARAM":
                self.next()
            elif self.at_punct("["):
                self.parse_value()
            else:
                self.parse_add()
            return
        if tok.kind == "KEYWORD" and tok.text.upper() == "IS":
            self.next()
            if self.at_kw("NOT"):
                self.next()
            self.expect("KEYWORD", "NULL")
            return
        for kw in ("STARTS", "ENDS"):
            if tok.kind == "KEYWORD" and tok.text.upper() == kw:
                self.next()
                self.expect("KEYWORD", "WITH")
                self.parse_add()
                return
        if tok.kind == "KEYWORD" and tok.text.upper() == "CONTAINS":
            self.next()
            self.parse_add()
            return
        # bare operand (RETURN n / ORDER BY conf) is fine; WHERE needs a
        # predicate — a bare operand there is rejected to keep WHERE honest.
        # (RETURN parsing never calls parse_predicate directly... it does via
        # parse_or. A bare `RETURN n` parses as operand with no operator and
        # is accepted; `WHERE n` would be too — Neo4j treats truthy maps as
        # predicates, but we reject bare-node WHERE for clarity.)
        # NOTE: accepted deliberately — matches Cypher semantics.

    def parse_add(self):
        self.parse_mul()
        while self.peek().kind == "PUNCT" and self.peek().text in ("+", "-"):
            self.next()
            self.parse_mul()

    def parse_mul(self):
        self.parse_unary()
        while True:
            tok = self.peek()
            if (tok.kind == "PUNCT" and tok.text in ("*", "/", "%")) or (tok.kind == "OP" and tok.text == "*"):
                self.next()
                self.parse_unary()
            else:
                break

    def parse_unary(self):
        tok = self.peek()
        if tok.kind == "PUNCT" and tok.text in ("-", "+"):
            self.next()
            self.parse_unary()
            return
        self.parse_postfix()

    def parse_postfix(self):
        tok = self.peek()
        if tok.kind == "IDENT":
            name = self.next().text
            if self.at_punct("("):
                # Any call shape parses here; the verifier allowlists names.
                # (Parser stays purely syntactic; policy lives one layer up.)
                self.next()
                if not self.at_punct(")"):
                    while True:
                        if self.at_punct("*"):
                            self.next()
                        else:
                            self.parse_or()
                        if self.at_punct(","):
                            self.next()
                            continue
                        break
                self.expect("PUNCT", ")")
                return
            if self.at_punct("."):
                self.next()
                prop = self.next()
                if prop.kind not in ("IDENT", "KEYWORD"):
                    raise CypherInvalid("expected a property name after .")
                return
            return
        if tok.kind == "PARAM":
            self.next()
            return
        if tok.kind in ("STRING", "INT", "FLOAT"):
            self.next()
            return
        if tok.kind == "KEYWORD" and tok.text.upper() in ("TRUE", "FALSE", "NULL"):
            self.next()
            return
        if tok.kind == "PUNCT" and tok.text == "(":
            self.next()
            self.parse_or()
            self.expect("PUNCT", ")")
            return
        if tok.kind == "PUNCT" and tok.text == "[":
            self.parse_value()
            return
        raise CypherInvalid(f"unexpected {tok.text!r} in expression")


def parse(cypher: str) -> ParsedQuery:
    """Parse restricted Cypher or raise CypherInvalid."""
    if not (cypher or "").strip():
        raise CypherInvalid("empty query")
    return _Parser(tokenize(cypher)).parse()
