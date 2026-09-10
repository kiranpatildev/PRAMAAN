"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Rule = {
  id: number; kind: string; case: number | null; case_fir?: string;
  min_severity: string; min_confidence: number; email_digest: boolean; enabled: boolean;
};

/** Alerts center: case feed, my notifications, routing rules, mock digests. */
export function AlertsCenter() {
  const [tab, setTab] = useState<"feed" | "mine" | "rules" | "digests">("feed");
  const [feed, setFeed] = useState<{ id: number; kind: string; severity: string; message: string; case_fir: string; created_at: string }[]>([]);
  const [mine, setMine] = useState<{ id: number; alert: { kind: string; severity: string; message: string }; read: boolean }[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [digests, setDigests] = useState<{ id: number; alert: { message: string }; created_at: string }[]>([]);
  const [kind, setKind] = useState("any");
  const [minSev, setMinSev] = useState("low");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [f, m, r, d] = await Promise.all([
        api.alertsFeed(),
        api.notifications(),
        api.alertRules(),
        api.notifications(false, "email_mock"),
      ]);
      setFeed(f.results ?? f);
      setMine(m.results ?? m);
      setRules(r.results ?? r);
      setDigests(d.results ?? d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts (log in first)");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addRule() {
    setError("");
    try {
      await api.createRule({ kind, min_severity: minSev });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rule creation failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {(["feed", "mine", "rules", "digests"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg border px-3 py-1 ${tab === t ? "border-accent text-accent" : "border-ink-700 text-slate-400"}`}>
            {t === "feed" ? "Case feed" : t === "mine" ? "My notifications" : t === "rules" ? "Routing rules" : "Email digests (mock)"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-risk-high">{error}</p>}

      {tab === "feed" && (
        <div className="card divide-y divide-ink-700 text-sm">
          {feed.map((a) => (
            <div key={a.id} className="py-2">
              <span className="text-xs text-slate-500">[{a.severity}] {a.kind} · {a.case_fir || "system"} · {new Date(a.created_at).toLocaleString()}</span>
              <p>{a.message}</p>
            </div>
          ))}
          {feed.length === 0 && <p className="py-3 text-slate-500">No alerts in your cases yet.</p>}
        </div>
      )}

      {tab === "mine" && (
        <div className="card divide-y divide-ink-700 text-sm">
          {mine.map((n) => (
            <div key={n.id} className={`flex items-center justify-between py-2 ${n.read ? "opacity-60" : ""}`}>
              <span><b>[{n.alert.severity}]</b> {n.alert.message}</span>
              {!n.read && <button className="text-xs text-accent hover:underline"
                onClick={() => api.markNotification(n.id).then(refresh).catch(() => {})}>mark read</button>}
            </div>
          ))}
          {mine.length === 0 && <p className="py-3 text-slate-500">No notifications.</p>}
        </div>
      )}

      {tab === "rules" && (
        <div className="card text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
              {["any", "connection", "risk", "cross_case", "anomaly", "system"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select className="input !w-auto" value={minSev} onChange={(e) => setMinSev(e.target.value)}>
              {["low", "medium", "high"].map((k) => <option key={k} value={k}>{k}+</option>)}
            </select>
            <button className="btn" onClick={addRule}>Add rule (all my cases)</button>
          </div>
          <div className="mt-2 divide-y divide-ink-700">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{r.kind}</b> <span className="text-xs text-slate-400">
                    {r.min_severity}+ · conf ≥ {(r.min_confidence * 100).toFixed(0)}% · {r.case_fir ?? "all cases"} · {r.enabled ? "on" : "off"} · digest {r.email_digest ? "on" : "off"}
                  </span>
                </span>
                <span className="flex gap-2 text-xs">
                  <button className="text-accent hover:underline"
                    onClick={() => api.patchRule(r.id, { enabled: !r.enabled }).then(refresh).catch(() => {})}>
                    {r.enabled ? "disable" : "enable"}
                  </button>
                  <button className="text-accent hover:underline"
                    onClick={() => api.patchRule(r.id, { email_digest: !r.email_digest }).then(refresh).catch(() => {})}>
                    digest {r.email_digest ? "off" : "on"}
                  </button>
                  <button className="text-risk-high hover:underline"
                    onClick={() => api.deleteRule(r.id).then(refresh).catch(() => {})}>delete</button>
                </span>
              </div>
            ))}
            {rules.length === 0 && <p className="py-3 text-slate-500">No rules — add one to get realtime pushes. Without rules, events still appear in the case feed.</p>}
          </div>
        </div>
      )}

      {tab === "digests" && (
        <div className="card divide-y divide-ink-700 text-sm">
          {digests.map((d) => (
            <div key={d.id} className="py-2">
              <span className="text-xs text-slate-500">{new Date(d.created_at).toLocaleString()}</span>
              <p>{d.alert.message}</p>
            </div>
          ))}
          {digests.length === 0 && <p className="py-3 text-slate-500">No digests yet — enable “digest” on a rule and run <code>manage.py send_digest</code>.</p>}
        </div>
      )}
    </div>
  );
}
