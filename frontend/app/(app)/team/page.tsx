"use client";

import { useEffect, useState } from "react";
import { UserPlus, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { KpiStrip } from "@/components/ui/KpiStrip";
import { Panel } from "@/components/ui/Panel";
import { Table, TableSkeleton } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { listUsers, registerUser, listCases, assignCase, unassignCase } from "@/lib/endpoints";
import { isSho, displayName } from "@/lib/auth";
import { initials, caseId } from "@/lib/format";
import { useSession } from "@/components/shell/useSession";
import type { CaseItem, User } from "@/lib/types";

function CreateInvestigatorModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ username: "", password: "", first_name: "", last_name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username.trim() || form.password.length < 8 || busy) return;
    setBusy(true);
    setError("");
    try {
      await registerUser({ ...form, role: "investigator" });
      toast({ kind: "ok", title: "Investigator created", body: form.username });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create investigator" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="ci-user">Username</label>
          <Input id="ci-user" value={form.username} onChange={set("username")} autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="ci-first">First name</label>
            <Input id="ci-first" value={form.first_name} onChange={set("first_name")} autoComplete="off" />
          </div>
          <div>
            <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="ci-last">Last name</label>
            <Input id="ci-last" value={form.last_name} onChange={set("last_name")} autoComplete="off" />
          </div>
        </div>
        <div>
          <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="ci-pass">Password (min 8)</label>
          <Input id="ci-pass" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        </div>
        {error && <Notice variant="warn">{error}</Notice>}
        <Button variant="primary" className="w-full" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create investigator"}
        </Button>
      </form>
    </Modal>
  );
}

export default function TeamPage() {
  const { user } = useSession();
  const toast = useToast();
  const sho = isSho(user?.role);
  const [investigators, setInvestigators] = useState<User[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([listUsers(), listCases({ limit: 100, ordering: "id" })])
      .then(([users, cs]) => {
        setInvestigators(users.filter((u) => u.role === "investigator"));
        setCases(cs.results);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  if (user && !sho) {
    return (
      <div>
        <PageHeader eyebrow="Operations" title="Team" sub="Investigator roster and case assignments." />
        <Empty icon={ShieldAlert} title="403 — Forbidden" body="The team roster is visible to SHO and Admin only." />
      </div>
    );
  }

  const assigned = new Map<number, Set<number>>();
  for (const c of cases) {
    assigned.set(c.id, new Set((c.assignments ?? []).map((a) => a.user.id)));
  }
  const caseCount = (uid: number) => cases.filter((c) => assigned.get(c.id)?.has(uid)).length;

  async function toggle(caseIdN: number, uid: number, on: boolean) {
    try {
      if (on) await unassignCase(caseIdN, uid);
      else await assignCase(caseIdN, uid, "edit");
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Assignment failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Team"
        sub="Investigator roster and the case assignment matrix."
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <UserPlus size={14} strokeWidth={1.6} aria-hidden /> Create investigator
          </Button>
        }
      />
      {showCreate && <CreateInvestigatorModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          <KpiStrip
            items={investigators.map((u) => ({
              label: `#${u.id}`,
              dot: "#00d9ff",
              value: displayName(u),
              monoValue: false,
              valueClass: "!font-ui !text-[15px]",
              sub: `${caseCount(u.id)} cases assigned`,
            }))}
          />
        </div>
      )}

      <Panel title="Assignment matrix" className="mt-[18px]" flush>
        {loading ? (
          <TableSkeleton rows={6} />
        ) : (
          <Table<CaseItem>
            columns={[
              {
                key: "case",
                head: "Case",
                width: "30%",
                render: (c) => (
                  <span>
                    <b className="block text-[12.5px] font-medium text-fg">{c.title}</b>
                    <span className="font-mono text-[10.5px] text-fg-4">{caseId(c.id)}</span>
                  </span>
                ),
              },
              ...investigators.map((u) => ({
                key: `u${u.id}`,
                head: `${initials(displayName(u))} · ${displayName(u).split(" ")[0]}`,
                render: (c: CaseItem) => {
                  const on = assigned.get(c.id)?.has(u.id) ?? false;
                  return (
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(c.id, u.id, on)}
                      aria-label={`${displayName(u)} on ${c.title}`}
                      className="h-[14px] w-[14px] accent-[#00d9ff]"
                    />
                  );
                },
              })),
            ]}
            rows={cases}
          />
        )}
      </Panel>
    </div>
  );
}
