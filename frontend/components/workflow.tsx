"use client";

/** Notes & Log tab: "Notes & Tasks" (composer + avatar feed + tasks/links)
 *  and "Audit Log" (dense monospace factual record, no edit controls). */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel, Avatar, EmptyState, ErrorState, friendlyError, StatusPill, Icon } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type Task = {
  id: number; title: string; description: string; assignee: number | null;
  assignee_name: string; status: string; due_date: string | null;
};
type Comment = { id: number; author_name: string; text: string; created_at: string };
type Link = { id: number; from_case: number; from_fir: string; to_case: number; to_fir: string; reason: string };
type FeedItem = { ts: string; kind: string; actor: string; text: string };

/** Render @mentions as clickable chips. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(@[\w\s.]{1,40}?)(?=\s|$|[,.])/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("@") && p.length > 1 ? (
          <span key={i} className="rounded bg-[#3B82F6]/15 px-1 py-px font-mono text-xs text-[#3B82F6]">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

export function WorkflowPanel({ caseId }: { caseId: string }) {
  const [view, setView] = useState<"notes" | "audit">("notes");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [t, c, l, a] = await Promise.all([
        api.caseTasks(caseId),
        api.caseComments(caseId),
        api.caseLinks(caseId),
        api.caseActivity(caseId),
      ]);
      setTasks(t.results ?? t);
      setComments(c.results ?? c);
      setLinks(l.results ?? l);
      setFeed(a.activity ?? []);
      setError("");
    } catch (e) {
      setError(friendlyError(e, "Workflow load failed"));
    }
  }, [caseId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(p: Promise<unknown>, clear?: () => void) {
    setError("");
    try {
      await p;
      clear?.();
      await refresh();
    } catch (e) {
      setError(friendlyError(e, "Action failed"));
    }
  }

  const openTasks = tasks.filter((x) => x.status !== "done").length;

  return (
    <Panel
      title="Notes & Log"
      right={
        <div className="flex gap-1.5" role="tablist" aria-label="Notes views">
          {(["notes", "audit"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${view === v ? "border-[#3B82F6] bg-[#3B82F6]/12 text-[#3B82F6]" : "border-[#1F2733] text-[#8B93A1] hover:text-[#E5E7EB]"}`}>
              {v === "notes" ? "Notes & Tasks" : "Audit Log"}
            </button>
          ))}
        </div>
      }
    >
      {error && <div className="mb-3"><ErrorState detail={error} onRetry={refresh} /></div>}

      {view === "notes" && (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) act(api.postComment(caseId, text), () => setText("")); }}>
              <input className="input" placeholder="Add an investigation note… (@-mention an entity)" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn shrink-0" type="submit">Add Note</button>
            </form>

            <div className="mt-3 space-y-2.5">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5 rounded-lg border border-[#1F2733] bg-[#0B0F17] p-3">
                  <Avatar name={c.author_name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[13px]">{c.author_name}</b>
                      <span className="font-mono text-[10px] text-[#8B93A1]">{c.created_at ? timeAgo(c.created_at) : ""}</span>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed"><RichText text={c.text} /></p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <EmptyState icon="note" title="No notes yet" hint="Notes capture investigator reasoning. @-mention an entity to chip it." />
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) act(api.createTask(caseId, { title }), () => setTitle("")); }}>
                <input className="input !py-1.5 text-xs" placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
                <button className="btn shrink-0 !px-3 !py-1.5 text-xs" type="submit">Add</button>
              </form>
              <div className="mt-2 divide-y divide-[#1F2733]">
                {tasks.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13px]">
                    <span className={t.status === "done" ? "line-through opacity-60" : ""}>
                      <StatusPill status={t.status} /> <span className="ml-1.5">{t.title}</span>
                      {t.assignee_name && <span className="ml-1.5 font-mono text-[11px] text-[#8B93A1]">· {t.assignee_name}</span>}
                    </span>
                    <span className="flex gap-2 font-mono text-[11px]">
                      {t.status !== "done" && <button className="text-[#10B981] hover:underline" onClick={() => act(api.patchTask(caseId, t.id, { status: t.status === "todo" ? "doing" : "done" }))}>advance</button>}
                      <button className="text-[#EF4444] hover:underline" onClick={() => act(api.deleteTask(caseId, t.id))}>delete</button>
                    </span>
                  </div>
                ))}
                {tasks.length === 0 && <p className="py-2 text-xs text-[#8B93A1]">No tasks{openTasks === 0 ? "." : ""}</p>}
              </div>
            </div>

            <div>
              <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B93A1]">
                Case links
              </p>
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (linkTo.trim()) act(api.createLink(caseId, Number(linkTo), linkReason), () => { setLinkTo(""); setLinkReason(""); }); }}>
                <input className="input !w-24 !py-1.5 text-xs" placeholder="Case ID" value={linkTo} onChange={(e) => setLinkTo(e.target.value)} />
                <input className="input min-w-0 flex-1 !py-1.5 text-xs" placeholder="Reason (e.g. shared phone 98765…)" value={linkReason} onChange={(e) => setLinkReason(e.target.value)} />
                <button className="btn shrink-0 !px-3 !py-1.5 text-xs" type="submit">Link</button>
              </form>
              <div className="mt-2 divide-y divide-[#1F2733] text-[13px]">
                {links.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <Icon name="link" className="h-3.5 w-3.5 text-[#3B82F6]" />
                      <b className="font-mono text-xs">{l.from_fir}</b>
                      <span className="text-[#8B93A1]">↔</span>
                      <b className="font-mono text-xs">{l.to_fir}</b>
                      <span className="text-xs text-[#8B93A1]">{l.reason}</span>
                    </span>
                    <button className="font-mono text-[11px] text-[#EF4444] hover:underline" onClick={() => act(api.deleteLink(caseId, l.id))}>unlink</button>
                  </div>
                ))}
                {links.length === 0 && <p className="py-2 text-xs text-[#8B93A1]">No formal links. Confirm cross-case matches into links here.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "audit" && (
        <div>
          <p className="mb-2 font-mono text-[11px] text-[#8B93A1]">
            Immutable record — every upload, review, merge, and note on this case. No edits possible here.
          </p>
          {feed.length === 0 ? (
            <EmptyState icon="shield" title="No activity yet" hint="Actions on this case will be recorded here with timestamps." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-[#1F2733]">
              <table className="w-full min-w-[560px] font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#1F2733] bg-[#0B0F17] text-left text-[10px] uppercase tracking-[0.12em] text-[#8B93A1]">
                    <th className="px-3 py-2 font-semibold">Timestamp</th>
                    <th className="px-3 py-2 font-semibold">Kind</th>
                    <th className="px-3 py-2 font-semibold">Actor</th>
                    <th className="px-3 py-2 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2733]">
                  {feed.map((f, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-[#8B93A1]">{new Date(f.ts).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-[#3B82F6]">{f.kind}</td>
                      <td className="px-3 py-1.5">{f.actor}</td>
                      <td className="px-3 py-1.5 text-[#E5E7EB]">{f.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
