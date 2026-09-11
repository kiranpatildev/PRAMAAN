"use client";

/** Shared SHO case actions: Create-case + Import-from-ICJS modals.
 *  Used by /cases and the SHO dashboard variant. SHO-only callers only. */
import { useState } from "react";
import { api } from "@/lib/api";
import { IcjsImportFlow } from "@/components/icjs-import";
import { Icon } from "@/components/ui";

export function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button className="rounded-md p-1 text-[#8B93A1] hover:text-[#E5E7EB]" onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CreateCaseForm({ onDone }: { onDone: (id: number) => void }) {
  const [form, setForm] = useState({ fir_no: "", title: "", station: "", district: "", state: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fir_no.trim() || !form.title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.createCase(form);
      onDone(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 text-sm">
      <input className="input" placeholder="FIR number (required)" value={form.fir_no} onChange={set("fir_no")} />
      <input className="input" placeholder="Title (required)" value={form.title} onChange={set("title")} />
      <div className="grid grid-cols-3 gap-2">
        <input className="input" placeholder="Station" value={form.station} onChange={set("station")} />
        <input className="input" placeholder="District" value={form.district} onChange={set("district")} />
        <input className="input" placeholder="State" value={form.state} onChange={set("state")} />
      </div>
      {error && <p className="text-sm text-[#EF4444]">{error}</p>}
      <button className="btn w-full" disabled={busy} type="submit">
        {busy ? "Creating…" : "Create case"}
      </button>
    </form>
  );
}

/** SHO-only action pair. Renders nothing for other roles. */
export function ShoCaseActions({ role, onOpen }: { role?: string | null; onOpen: (m: "create" | "import") => void }) {
  if (role !== "sho" && role !== "admin") return null;
  return (
    <div className="flex gap-2">
      <button className="btn !px-3 !py-1.5 text-sm" onClick={() => onOpen("create")}>
        <Icon name="plus" className="h-4 w-4" /> Create case
      </button>
      <button className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => onOpen("import")}>
        <Icon name="download" className="h-4 w-4" /> Import case
      </button>
    </div>
  );
}

export function CaseModals({ modal, onClose, onDone }: {
  modal: "create" | "import" | null; onClose: () => void; onDone: (id: number) => void;
}) {
  if (modal === "create") {
    return (
      <Modal title="Create case" onClose={onClose}>
        <CreateCaseForm onDone={onDone} />
      </Modal>
    );
  }
  if (modal === "import") {
    return (
      <Modal title="Import case from ICJS" onClose={onClose}>
        <p className="mt-1 text-xs text-[#8B93A1]">
          Pulls manifest + evidence bundle from ICJS and creates the case — same pipeline as manual upload.
        </p>
        <IcjsImportFlow onDone={onDone} />
      </Modal>
    );
  }
  return null;
}
