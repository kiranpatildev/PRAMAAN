"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Available = { case_id: string; title: string; state?: string; district?: string };
type Step = { key: string; label: string; state: "active" | "done" | "error" };

function socketUrl(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("pramaan_access");
  if (!token) return null;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/alerts/?token=${token}`;
}

/** Import-from-ICJS panel: lives next to the manual uploader and feeds the
 *  exact same pipeline. Live checklist is driven by real WS progress frames
 *  (kind icjs_import_progress) on the shared alerts socket. */
export function IcjsImportPanel({ caseId, onImported }: { caseId: string; onImported: () => void }) {
  const { t } = useI18n();
  const [options, setOptions] = useState<Available[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [done, setDone] = useState<{ imported: number; failed: number; status: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api.icjsAvailableCases()
      .then((d) => setOptions(d.cases ?? []))
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => () => { wsRef.current?.close(); wsRef.current = null; }, []);

  function upsertStep(key: string, label: string, state: Step["state"]) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = { key, label, state };
        return next;
      }
      return [...prev, { key, label, state }];
    });
  }

  function watchProgress(externalId: string) {
    const url = socketUrl();
    if (!url) return;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type !== "alert" || msg.kind !== "icjs_import_progress") return;
          if (String(msg.case_id) !== String(caseId)) return;
          if (msg.external_case_id !== externalId) return;
          if (msg.phase === "connected" || msg.phase === "case_found") {
            upsertStep(msg.phase, msg.message || msg.phase, "done");
          } else if (msg.phase === "fetching") {
            upsertStep(`file:${msg.filename}`, `Fetching ${msg.filename}…`, "active");
          } else if (msg.phase === "received") {
            upsertStep(`file:${msg.filename}`, `${msg.filename} received`, "done");
          } else if (msg.phase === "failed") {
            upsertStep(`file:${msg.filename}`, `${msg.filename} failed`, "error");
          } else if (msg.phase === "complete") {
            ws.close();
          }
        } catch {
          /* ignore malformed frames */
        }
      };
    } catch {
      /* WS unavailable — final POST response still reports the outcome */
    }
  }

  async function runImport() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setSteps([]);
    setDone(null);
    watchProgress(selected);
    try {
      const res = await api.icjsImport(caseId, selected);
      setDone({ imported: res.files_imported, failed: res.files_failed, status: res.status });
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      wsRef.current?.close();
      wsRef.current = null;
    }
  }

  const icon = (s: Step["state"]) => (s === "done" ? "✓" : s === "error" ? "✗" : "⏳");

  return (
    <div className="mt-3 rounded-lg border border-ink-700 p-3 text-sm">
      <div className="flex items-center justify-between">
        <b>{t("icjs.title", "Import from ICJS")}</b>
        <span className="text-xs text-slate-400">{t("icjs.subtitle", "Pull an external case bundle — same pipeline")}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select className="input !w-auto flex-1" value={selected}
          onChange={(e) => setSelected(e.target.value)} disabled={busy}>
          <option value="">{t("icjs.pick", "Pick an ICJS case…")}</option>
          {options.map((o) => (
            <option key={o.case_id} value={o.case_id}>{o.case_id} — {o.title}{o.state ? ` (${o.state}${o.district ? ", " + o.district : ""})` : ""}</option>
          ))}
        </select>
        <button className="btn" disabled={busy || !selected} onClick={runImport}>
          {busy ? t("icjs.importing", "Importing…") : t("icjs.import", "Import case")}
        </button>
      </div>
      {options.length === 0 && !error && (
        <p className="mt-1 text-xs text-slate-500">ICJS service unreachable — is mock-icjs running?</p>
      )}
      {error && <p className="mt-2 text-sm text-risk-high">{error}</p>}
      {steps.length > 0 && (
        <ul className="mt-2 space-y-1">
          {steps.map((s) => (
            <li key={s.key} className={s.state === "error" ? "text-risk-high" : s.state === "done" ? "text-risk-low" : ""}>
              {icon(s.state)} {s.label}
            </li>
          ))}
        </ul>
      )}
      {done && (
        <p className="mt-2">
          {done.imported} files imported{done.failed > 0 ? `, ${done.failed} failed` : ""} — pipeline processing started.{" "}
          <a className="text-accent hover:underline" href={`/cases/${caseId}`}>
            {t("icjs.reviewLink", "Open review queue →")}
          </a>
        </p>
      )}
    </div>
  );
}
