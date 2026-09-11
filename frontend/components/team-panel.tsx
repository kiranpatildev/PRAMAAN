"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Member = { id: number; user: { id: number; username: string; role: string }; permission: string };
type UserOpt = { id: number; username: string; role: string };

/** Case team: who is assigned with what role. Rendered for SHO only —
 *  the assign endpoint 403s everyone else server-side. */
export function TeamPanel({ caseId, isSHO }: { caseId: string; isSHO: boolean }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState("edit");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await api.cases(`${caseId}/`);
      setMembers(d.assignments ?? []);
      if (isSHO) {
        const u = await api.users();
        setUsers(u.results ?? u);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    }
  }, [caseId, isSHO]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isSHO) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.assignCase(caseId, Number(userId), permission);
      setUserId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="font-semibold">{t("team.title", "Case team")}</h2>
      <p className="mt-1 text-xs text-slate-400">
        {t("team.sub", "Assign investigators with view, edit, or admin access. They see the case immediately.")}
      </p>
      {error && <p className="mt-2 text-sm text-risk-high">{error}</p>}
      <div className="mt-2 divide-y divide-ink-700 text-sm">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-1.5">
            <span><b>{m.user.username}</b> <span className="text-xs text-slate-500">· {m.user.role}</span></span>
            <span className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-accent">{m.permission}</span>
          </div>
        ))}
        {members.length === 0 && <p className="py-2 text-sm text-slate-500">No investigators assigned yet.</p>}
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <select className="input !w-auto flex-1" value={userId}
          onChange={(e) => setUserId(e.target.value)} disabled={busy}>
          <option value="">{t("team.pick", "Pick investigator…")}</option>
          {users.filter((u) => u.role === "investigator").map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>
        <select className="input !w-auto" value={permission}
          onChange={(e) => setPermission(e.target.value)} disabled={busy}>
          <option value="view">view</option>
          <option value="edit">edit</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn" disabled={busy || !userId} type="submit">
          {busy ? "Assigning…" : t("team.assign", "Assign")}
        </button>
      </form>
    </div>
  );
}
