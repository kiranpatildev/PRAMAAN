"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Avatar } from "@/components/ui/Avatar";
import { assistantQuery } from "@/lib/endpoints";
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
}

function AssistantBody() {
  const params = useSearchParams();
  const caseId = params.get("case") ?? undefined;
  const { user } = useSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
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

  return (
    <div>
      <PageHeader
        eyebrow="Retrieval-augmented"
        title="AI Assistant"
        sub={caseId ? `Scoped to case C-${caseId}. Answers cite that case's evidence.` : "Scoped to the cases you can access. Answers cite their evidence."}
      />
      <div className="grid grid-cols-[1.6fr_1fr] gap-[18px] max-[1100px]:grid-cols-1">
        <div className="flex h-[520px] flex-col overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex-1 space-y-4 overflow-y-auto p-[14px]">
            {turns.length === 0 && (
              <p className="font-mono text-[11px] text-fg-4">
                Ask about connections, key players, or anything in the evidence.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-start gap-2">
                  <Avatar name={displayName(user ?? undefined)} />
                  <p className="min-w-0 flex-1 pt-[2px] text-[12.5px] text-fg">{t.q}</p>
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
              ask(q);
            }}
          >
            <Input placeholder="Ask the assistant…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="primary" type="submit" disabled={busy}>
              Send
            </Button>
          </form>
        </div>

        <div className="space-y-[18px]">
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
          <Notice variant="lock">
            Retrieval is scoped to your visible cases. Hidden cases never leak into answers or citations.
          </Notice>
        </div>
      </div>
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
