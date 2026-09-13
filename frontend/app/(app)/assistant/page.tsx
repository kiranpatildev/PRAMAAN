"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Avatar } from "@/components/ui/Avatar";
import { assistantQuery, graphQueryCypher, graphQueryQuestion } from "@/lib/endpoints";
import type { GraphQueryAnswer } from "@/lib/types";
import { displayName } from "@/lib/auth";
import { useSession } from "@/components/shell/useSession";

const SUGGESTIONS = [
  "Summarize the key players in this case",
  "Which phone numbers appear in more than one case?",
  "What vehicles were mentioned in the evidence?",
  "List high-confidence relationships confirmed this week",
];

/** Minimal **bold** subset renderer. */
function RichAnswer({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <b key={i} className="font-semibold text-fg">{p.slice(2, -2)}</b>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

interface Turn {
  q: string;
  a: string;
  cites: { file_name?: string; case_fir?: string; snippet?: string }[];
  graph?: GraphQueryAnswer;
}

type AskMode = "ask" | "graph";

function AssistantBody() {
  const params = useSearchParams();
  const caseId = params.get("case") ?? undefined;
  const { user } = useSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<AskMode>("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(question: string) {
    const needle = question.trim();
    if (!needle || busy) return;
    setBusy(true);
    setError("");
    setQ("");
    try {
      const res = await assistantQuery(needle, caseId);
      setTurns((t) => [...t, { q: needle, a: res.answer, cites: res.citations ?? [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant failed");
    } finally {
      setBusy(false);
    }
  }

  async function askGraph(text: string) {
    const needle = text.trim();
    if (!needle || busy) return;
    setBusy(true);
    setError("");
    setQ("");
    try {
      // Raw Cypher stays on the deterministic path; anything else goes
      // through NL understanding (same verifier gate either way).
      const res = /^match\b/i.test(needle)
        ? await graphQueryCypher(needle, undefined, caseId)
        : await graphQueryQuestion(needle, caseId);
      setTurns((t) => [...t, { q: needle, a: res.answer_text, cites: [], graph: res }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph query failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Retrieval-augmented"
        title="AI Assistant"
        sub={caseId ? `Scoped to case C-${caseId}. Answers cite that case's evidence.` : "Scoped to the cases you can access. Answers cite their evidence."}
      />
      <div className="grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
        <div className="flex h-[520px] flex-col overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex gap-2 border-b border-line p-[10px_14px]" role="tablist" aria-label="Assistant mode">
            {(["ask", "graph"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-[3px] border px-2 py-1 font-mono text-[11px] transition-colors duration-120 ${
                  mode === m
                    ? "border-cyan-br text-cyan"
                    : "border-line-2 text-fg-3 hover:border-line-2 hover:text-fg"
                }`}
              >
                {m === "ask" ? "Ask" : "Graph"}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10.5px] text-fg-4">
              {mode === "graph" ? "NL or Cypher · verified + scoped" : "evidence Q&A"}
            </span>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-[14px]">
            {turns.length === 0 && (
              <p className="font-mono text-[11px] text-fg-4">
                {mode === "graph"
                  ? "Ask in plain words, or paste read-only Cypher starting with MATCH. Every query is verified and case-scoped before it runs."
                  : "Ask about connections, key players, or anything in the evidence."}
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-start gap-2">
                  <Avatar name={displayName(user ?? undefined)} />
                  {t.graph ? (
                    <p className="min-w-0 flex-1 break-all pt-[2px] font-mono text-[11.5px] text-fg">{t.q}</p>
                  ) : (
                    <p className="min-w-0 flex-1 pt-[2px] text-[12.5px] text-fg">{t.q}</p>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <span className="flex h-[22px] shrink-0 items-center rounded-[3px] border border-cyan-br bg-cyan-bg px-[6px] font-mono text-[10px] font-semibold text-cyan">
                    AI
                  </span>
                  <div className="min-w-0 flex-1 text-[12.5px] leading-[1.65] text-fg-2">
                    <RichAnswer text={t.a} />
                    {t.cites.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-line pt-2">
                        {t.cites.slice(0, 4).map((c, j) => (
                          <li key={j} className="font-mono text-[10.5px] text-fg-4">
                            [{j + 1}] {c.file_name ?? "evidence"} {c.case_fir ? `· ${c.case_fir}` : ""}
                            {c.snippet ? ` — “${c.snippet.slice(0, 90)}”` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.graph && (
                      <GraphTurn turn={t} caseId={caseId} />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {busy && <p className="font-mono text-[11px] text-fg-4">Retrieving…</p>}
          </div>
          {error && (
            <div className="border-t border-line p-[10px_14px]">
              <Notice variant="warn">{error}</Notice>
            </div>
          )}
          <form
            className="flex gap-2 border-t border-line p-[10px_14px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "graph") askGraph(q);
              else ask(q);
            }}
          >
            <Input
              placeholder={mode === "graph" ? "Who called 9876543210? (or paste MATCH…)" : "Ask the assistant…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button variant="primary" type="submit" disabled={busy}>
              {mode === "graph" ? "Run" : "Send"}
            </Button>
          </form>
        </div>

        <div className="space-y-[18px]">
          {mode === "graph" && (
            <Panel title="Graph query rules">
              <ul className="space-y-1 font-mono text-[11px] leading-[1.6] text-fg-3">
                <li>· Read-only: MATCH / WHERE / RETURN only.</li>
                <li>· Every node needs a variable + :Case label.</li>
                <li>· Case scoping is injected server-side.</li>
                <li>· Results clamp at 100 rows.</li>
              </ul>
            </Panel>
          )}
          {mode === "ask" && (
            <Panel title="Suggested queries">
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block w-full rounded border border-line bg-panel-2 px-3 py-2 text-left font-mono text-[12.5px] text-fg-2 transition-colors duration-120 hover:border-line-2 hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Notice variant="lock">
            {mode === "graph"
              ? "Graph queries run read-only, case-scoped, and every run is audit-logged."
              : "Retrieval is scoped to your visible cases. Hidden cases never leak into answers or citations."}
          </Notice>
        </div>
      </div>
    </div>
  );
}

function GraphTurn({ turn, caseId }: { turn: Turn; caseId?: string }) {
  const g = turn.graph;
  if (!g) return null;
  const isolateHref =
    caseId && g.node_ids.length
      ? `/cases/${caseId}?tab=network&isolate=${encodeURIComponent(g.node_ids.join(","))}`
      : null;
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <p className="font-mono text-[10.5px] text-fg-4">
        confidence {Math.round(g.confidence * 100)}%
        {g.explanation ? ` · ${g.explanation}` : ""}
      </p>
      {g.cypher_shown ? (
        <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-panel-2 p-2 font-mono text-[10.5px] leading-[1.6] text-fg-2">
          {g.cypher_shown}
        </pre>
      ) : null}
      {isolateHref ? (
        <a
          href={isolateHref}
          className="inline-flex h-[26px] items-center rounded-[3px] border border-cyan-br px-2 font-mono text-[11px] text-cyan transition-colors duration-120 hover:bg-cyan-bg"
        >
          Isolate on graph →
        </a>
      ) : (
        <p className="font-mono text-[10.5px] text-fg-4">
          {g.node_ids.length ? "Open a case-scoped chat (?case=) to isolate these nodes." : ""}
        </p>
      )}
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense>
      <AssistantBody />
    </Suspense>
  );
}
