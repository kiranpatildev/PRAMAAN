"use client";

import { useEffect, useState } from "react";
import { Check, StickyNote, ListTodo } from "lucide-react";
import { Panel } from "../ui/Panel";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Avatar } from "../ui/Avatar";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import {
  caseTasks, createTask, patchTask, deleteTask,
  caseComments, postComment, deleteComment,
} from "@/lib/endpoints";
import { displayName } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { useToast } from "../ui/Toast";
import { useSession } from "../shell/useSession";
import type { Note, Task } from "@/lib/types";

export function NotesTasksTab({ caseId: cid, sho }: { caseId: string | number; sho: boolean }) {
  const toast = useToast();
  const { user } = useSession();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    Promise.all([caseComments(cid), caseTasks(cid)])
      .then(([c, t]) => {
        setNotes(c);
        setTasks(t);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Notes and tasks failed to load"));
  };

  useEffect(refresh, [cid]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    try {
      await postComment(cid, noteText.trim());
      setNoteText("");
      setNoteOpen(false);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Note failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function removeNote(id: number) {
    try {
      await deleteComment(cid, id);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Delete failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskText.trim()) return;
    try {
      await createTask(cid, { title: taskText.trim() });
      setTaskText("");
      setTaskOpen(false);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Task failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function toggleTask(t: Task) {
    const done = t.status === "done";
    try {
      await patchTask(cid, t.id, { status: done ? "todo" : "done" });
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Update failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  const authorOf = (n: Note) => n.author_name ?? n.by ?? "?";
  const meName = user ? displayName(user) : "";

  return (
    <div>
      {error && (
        <div className="mb-[18px]">
          <Notice variant="warn">{error}</Notice>
        </div>
      )}
      <div className="grid grid-cols-2 gap-[18px] max-[1100px]:grid-cols-1">
        <Panel
          title="Notes"
          right={
            <Button variant="ghost" small onClick={() => setNoteOpen((o) => !o)}>
              + Add note
            </Button>
          }
        >
          {noteOpen && (
            <form onSubmit={addNote} className="mb-3 flex gap-2">
              <Input placeholder="Write a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <Button variant="primary" type="submit">
                Add
              </Button>
            </form>
          )}
          {notes.length === 0 ? (
            <Empty icon={StickyNote} title="No notes yet" body="Capture reasoning, hunches and observations here." />
          ) : (
            <ul className="space-y-[10px]">
              {notes.map((n) => (
                <li key={n.id} className="group relative rounded border border-line bg-panel-2 p-[12px]">
                  <p className="flex items-center gap-2">
                    <Avatar name={authorOf(n)} />
                    <span className="text-[12px] font-medium text-fg">{authorOf(n)}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-fg-4">
                      {timeAgo(n.created_at ?? n.at ?? "")}
                    </span>
                    {(sho || authorOf(n) === meName) && (
                      <button
                        type="button"
                        onClick={() => removeNote(n.id)}
                        aria-label="Delete note"
                        className="text-[11.5px] text-red opacity-0 transition-colors duration-120 hover:underline group-hover:opacity-100"
                      >
                        delete
                      </button>
                    )}
                  </p>
                  <p className="mt-2 text-[12.5px] leading-[1.6] text-fg-2">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Tasks"
          right={
            <Button variant="ghost" small onClick={() => setTaskOpen((o) => !o)}>
              + Add task
            </Button>
          }
        >
          {taskOpen && (
            <form onSubmit={addTask} className="mb-3 flex gap-2">
              <Input placeholder="New task…" value={taskText} onChange={(e) => setTaskText(e.target.value)} />
              <Button variant="primary" type="submit">
                Add
              </Button>
            </form>
          )}
          {tasks.length === 0 ? (
            <Empty icon={ListTodo} title="No tasks" body="Track verification and field work here." />
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((t) => {
                const done = t.status === "done";
                return (
                  <li key={t.id} className="group flex items-center gap-[10px] py-[9px]">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={done ? "Mark open" : "Mark done"}
                      onClick={() => toggleTask(t)}
                      className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-120 ${
                        done ? "border-green bg-green" : "border-line-2 bg-transparent hover:border-line-3"
                      }`}
                    >
                      {done && <Check size={11} strokeWidth={2.4} className="text-[#04121a]" aria-hidden />}
                    </button>
                    <span className={`min-w-0 flex-1 text-[12.5px] ${done ? "text-fg-4 line-through" : "text-fg-2"}`}>
                      {t.title ?? t.text}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{t.due_date ?? t.due ?? ""}</span>
                    <button
                      type="button"
                      onClick={() => deleteTask(cid, t.id).then(refresh).catch(() => {})}
                      aria-label="Delete task"
                      className="shrink-0 text-[11.5px] text-red opacity-0 transition-colors duration-120 hover:underline group-hover:opacity-100"
                    >
                      delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
