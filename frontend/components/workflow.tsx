"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Task = {
  id: number; title: string; description: string; assignee: number | null;
  assignee_name: string; status: string; due_date: string | null;
};
type Comment = { id: number; author_name: string; text: string; created_at: string };
type Link = { id: number; from_case: number; from_fir: string; to_case: number; to_fir: string; reason: string };
type FeedItem = { ts: string; kind: string; actor: string; text: string };

/** Case collaboration: tasks, comments, formal case links, activity feed. */
export function WorkflowPanel({ caseId }: { caseId: string }) {
  const [tab, setTab] = useState<"tasks" | "comments" | "links" | "activity">("tasks");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workflow load failed");
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
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  return (
    <div className="card">
      <div className="flex gap-2 text-sm">
        {(["tasks", "comments", "links", "activity"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg border px-3 py-1 capitalize ${tab === t ? "border-accent text-accent" : "border-ink-700 text-slate-400"}`}>
            {t}{t === "tasks" ? ` (${tasks.filter((x) => x.status !== "done").length})` : ""}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}

      {tab === "tasks" && (
        <>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); act(api.createTask(caseId, { title }), () => setTitle("")); }}>
            <input className="input" placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="btn" type="submit">Add</button>
          </form>
          <div className="mt-2 divide-y divide-ink-700 text-sm">
            {tasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className={t.status === "done" ? "line-through opacity-60" : ""}>
                  <b>[{t.status}]</b> {t.title}
                  {t.assignee_name && <span className="text-xs text-slate-500"> · {t.assignee_name}</span>}
                </span>
                <span className="flex gap-2 text-xs">
                  {t.status !== "done" && <button className="text-risk-low hover:underline" onClick={() => act(api.patchTask(caseId, t.id, { status: t.status === "todo" ? "doing" : "done" }))}>advance</button>}
                  <button className="text-risk-high hover:underline" onClick={() => act(api.deleteTask(caseId, t.id))}>delete</button>
                </span>
              </div>
            ))}
            {tasks.length === 0 && <p className="py-2 text-sm text-slate-500">No tasks.</p>}
          </div>
        </>
      )}

      {tab === "comments" && (
        <>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); act(api.postComment(caseId, text), () => setText("")); }}>
            <input className="input" placeholder="Comment…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" type="submit">Post</button>
          </form>
          <div className="mt-2 space-y-2 text-sm">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-ink-950 p-2">
                <span className="text-xs text-slate-500">{c.author_name} · {new Date(c.created_at).toLocaleString()}</span>
                <p>{c.text}</p>
              </div>
            ))}
            {comments.length === 0 && <p className="py-2 text-sm text-slate-500">No comments.</p>}
          </div>
        </>
      )}

      {tab === "links" && (
        <>
          <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act(api.createLink(caseId, Number(linkTo), linkReason), () => { setLinkTo(""); setLinkReason(""); }); }}>
            <input className="input !w-32" placeholder="Case ID" value={linkTo} onChange={(e) => setLinkTo(e.target.value)} />
            <input className="input flex-1" placeholder="Reason (e.g. shared phone 98765…)" value={linkReason} onChange={(e) => setLinkReason(e.target.value)} />
            <button className="btn" type="submit">Link</button>
          </form>
          <div className="mt-2 divide-y divide-ink-700 text-sm">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-1.5">
                <span>⇄ <b>{l.from_fir}</b> ↔ <b>{l.to_fir}</b> <span className="text-xs text-slate-500">{l.reason}</span></span>
                <button className="text-xs text-risk-high hover:underline" onClick={() => act(api.deleteLink(caseId, l.id))}>unlink</button>
              </div>
            ))}
            {links.length === 0 && <p className="py-2 text-sm text-slate-500">No formal links. Confirm cross-case matches into links here.</p>}
          </div>
        </>
      )}

      {tab === "activity" && (
        <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto text-sm">
          {feed.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-36 shrink-0 text-xs text-slate-500">{new Date(f.ts).toLocaleString()}</span>
              <span><b className="text-xs text-accent">{f.kind}</b> <span className="text-slate-400">{f.actor}</span> — {f.text}</span>
            </li>
          ))}
          {feed.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
        </ul>
      )}
    </div>
  );
}
