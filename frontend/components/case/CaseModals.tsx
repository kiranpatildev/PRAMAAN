"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createCase, icjsAvailable, icjsImport } from "@/lib/endpoints";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { useToast } from "../ui/Toast";

export function NewCaseModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ fir_no: "", title: "", station: "", district: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fir_no.trim() || !form.title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await createCase(form);
      toast({ kind: "ok", title: "Case created", body: `${form.fir_no} is ready for evidence.` });
      onDone(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New case" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="nc-fir">FIR number</label>
          <Input id="nc-fir" value={form.fir_no} onChange={set("fir_no")} placeholder="FIR-2026-1200" />
        </div>
        <div>
          <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="nc-title">Title</label>
          <Input id="nc-title" value={form.title} onChange={set("title")} placeholder="Short case title" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="nc-station">Station</label>
            <Input id="nc-station" value={form.station} onChange={set("station")} />
          </div>
          <div>
            <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="nc-district">District</label>
            <Input id="nc-district" value={form.district} onChange={set("district")} />
          </div>
        </div>
        {error && <Notice variant="warn">{error}</Notice>}
        <Button variant="primary" className="w-full" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create case"}
        </Button>
      </form>
    </Modal>
  );
}

export function ImportCaseModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [options, setOptions] = useState<{ case_id: string; title?: string }[]>([]);
  const [sel, setSel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    icjsAvailable()
      .then((d) => {
        setOptions(d.cases ?? []);
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not reach ICJS"));
  }, []);

  async function run() {
    if (!sel || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await icjsImport(sel);
      toast({ kind: "ok", title: "Import started", body: `${res.files_imported ?? 0} files queued for processing.` });
      if (res.case_id) onDone(res.case_id);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import from ICJS" onClose={onClose}>
      <p className="mb-3 text-[12.5px] text-fg-3">
        Pulls the manifest and evidence bundle from ICJS through the same pipeline as a manual upload.
      </p>
      {!loaded && !error && <p className="font-mono text-[11px] text-fg-4">Loading importable cases…</p>}
      {options.length > 0 && (
        <Select value={sel} onChange={(e) => setSel(e.target.value)} className="w-full" aria-label="External case">
          <option value="">Select an external case…</option>
          {options.map((o) => (
            <option key={o.case_id} value={o.case_id}>
              {o.case_id}{o.title ? ` — ${o.title}` : ""}
            </option>
          ))}
        </Select>
      )}
      {loaded && options.length === 0 && !error && (
        <Notice variant="lock">No importable cases on the ICJS bridge right now.</Notice>
      )}
      {error && <Notice variant="warn">{error}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!sel || busy} onClick={run}>
          {busy ? "Importing…" : "Import case"}
        </Button>
      </div>
    </Modal>
  );
}

export function useCaseModals() {
  const router = useRouter();
  const [modal, setModal] = useState<"new" | "import" | null>(null);
  const go = (id: number) => {
    setModal(null);
    router.push(`/cases/${id}`);
  };
  const nodes = (
    <>
      {modal === "new" && <NewCaseModal onClose={() => setModal(null)} onDone={go} />}
      {modal === "import" && <ImportCaseModal onClose={() => setModal(null)} onDone={go} />}
    </>
  );
  return { openNew: () => setModal("new"), openImport: () => setModal("import"), nodes };
}
