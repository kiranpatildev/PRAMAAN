"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, FolderSearch, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BrandMark } from "@/components/shell/Topbar";

type Door = "sho" | "investigator" | "admin";

const DOORS: { id: Door; label: string; sub: string; icon: typeof ShieldCheck }[] = [
  { id: "sho", label: "SHO", sub: "Oversight", icon: ShieldCheck },
  { id: "investigator", label: "Investigator", sub: "Evidence", icon: FolderSearch },
  { id: "admin", label: "Admin", sub: "Platform", icon: Settings2 },
];

const DOOR_LABEL: Record<Door, string> = { sho: "SHO", investigator: "Investigator", admin: "Admin" };

const DEMOS: { user: string; door: Door }[] = [
  { user: "sho_demo", door: "sho" },
  { user: "inv_demo", door: "investigator" },
  { user: "inv_priya", door: "investigator" },
  { user: "inv_amit", door: "investigator" },
  { user: "admin", door: "admin" },
];

const FEATURES: [string, string, string][] = [
  ["01", "Role-gated doors", "SHO, investigator and admin each enter through their own door. The wrong door rejects you, even with the right password."],
  ["02", "Evidence pipeline", "Uploads hash, classify, OCR and extract into a review queue. Nothing reaches the graph unconfirmed."],
  ["03", "Immutable audit log", "Every upload, confirmation, merge and note is written to a log nobody can edit."],
];

export default function LoginPage() {
  const router = useRouter();
  const [door, setDoor] = useState<Door | null>("investigator");
  const [username, setUsername] = useState("inv_demo");
  const [password, setPassword] = useState("Pramaan123!");
  const [code, setCode] = useState("");
  const [preToken, setPreToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function pickDoor(d: Door, user?: string) {
    setDoor(d);
    setError("");
    setPreToken(null);
    setCode("");
    if (user) {
      setUsername(user);
      setPassword("Pramaan123!");
    } else {
      setUsername(d === "sho" ? "sho_demo" : d === "admin" ? "admin" : "inv_demo");
      setPassword("Pramaan123!");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!door) {
      setError("Select an access door first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { refreshSession } = await import("@/components/shell/useSession");
      const data = await api.login(username, password, door);
      if (data.two_factor_required) {
        setPreToken(data.pre_token);
      } else {
        try {
          window.localStorage.setItem("pramaan_role", data.role ?? door);
        } catch { /* ignore */ }
        refreshSession();
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      // Wrong-door 403 renders the exact spec message.
      if (/wrong_?door|registered as|correct login type/i.test(msg)) {
        setError(`403 — Forbidden. ${username} cannot enter through the ${DOOR_LABEL[door]} door.`);
      } else {
        setError(msg.replace(/^API 403:\s*/, "403 — ").slice(0, 220));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!preToken || !door) return;
    setBusy(true);
    setError("");
    try {
      const { refreshSession } = await import("@/components/shell/useSession");
      await api.login2fa(preToken, code);
      refreshSession();
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-[1180px] grid-cols-[1.1fr_1fr] items-center gap-10 px-6 py-10">
      {/* LEFT */}
      <div className="max-[980px]:hidden">
        <p className="flex items-center gap-2">
          <BrandMark size={11} />
          <span className="text-[13.5px] font-semibold text-fg">Pramaan</span>
          <span className="font-mono text-[12px] text-fg-3">/ Evidence Intelligence</span>
        </p>
        <div className="h-12" aria-hidden />
        <h1 className="text-[46px] font-medium leading-[1.04] tracking-[-0.035em] text-fg">
          Case intelligence,
          <br />
          without the noise.
        </h1>
        <p className="mt-5 max-w-[500px] text-[14.5px] leading-[1.65] text-fg-2">
          Pramaan turns fragmented case material — FIRs, call records, statements,
          forensic reports — into one evidence-backed picture. Every link traces
          to its source, every action is logged, and every door is role-gated.
        </p>
        <div className="mt-8">
          {FEATURES.map(([n, title, desc], i) => (
            <div
              key={n}
              className={`grid grid-cols-[36px_1fr] gap-[14px] border-b border-line py-4 ${i === 0 ? "border-t border-line" : ""}`}
            >
              <span className="font-mono text-[11px] text-cyan">{n}</span>
              <span>
                <span className="block text-[13.5px] font-medium text-fg">{title}</span>
                <span className="mt-1 block text-[12.5px] text-fg-3">{desc}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-8 flex items-center gap-2 font-mono text-[11px] text-fg-3">
          <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-green" aria-hidden />
          mock-ICJS bridge online
          <span className="ml-auto">v2.4.1</span>
        </p>
      </div>

      {/* RIGHT */}
      <div className="mx-auto w-full max-w-[420px] rounded-md border border-line bg-panel p-8">
        <h2 className="text-[18px] font-medium tracking-[-0.02em] text-fg">Sign in</h2>
        <p className="mt-1 text-[12.5px] text-fg-3">Select an access door, then enter your credentials.</p>

        <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line" role="radiogroup" aria-label="Access door">
          {DOORS.map((d) => {
            const active = door === d.id;
            const Icon = d.icon;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickDoor(d.id)}
                className={`relative flex flex-col gap-[6px] p-[12px_10px] text-left transition-colors duration-120 ${
                  active ? "bg-panel-2" : "bg-panel hover:bg-panel-2"
                }`}
              >
                {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-cyan" aria-hidden />}
                <Icon size={16} strokeWidth={1.6} className={active ? "text-cyan" : "text-fg-4"} aria-hidden />
                <span className={`text-[12px] font-medium ${active ? "text-fg" : "text-fg-2"}`}>{d.label}</span>
                <span className="font-mono text-[9.5px] uppercase text-fg-4">{d.sub}</span>
              </button>
            );
          })}
        </div>

        {!preToken ? (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label className="mb-[6px] block text-[12.5px] text-fg-2" htmlFor="login-username">Username</label>
              <Input id="login-username" className="!h-[34px]" value={username}
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <div className="mb-[6px] flex items-baseline justify-between">
                <label className="text-[12.5px] text-fg-2" htmlFor="login-password">Password</label>
                <span className="font-mono text-[10.5px] text-fg-4">password Pramaan123!</span>
              </div>
              <Input id="login-password" className="!h-[34px]" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {/* 2FA enrollment is disabled for now. If the server requires a
                second factor (legacy enabled accounts), the verify form below
                appears automatically after the password step. */}
            {error && (
              <p className="rounded border border-red-br bg-red-bg px-[12px] py-[10px] text-[12.5px] text-red" role="alert">
                {error}
              </p>
            )}
            <Button id={door ? `login-submit-${door}` : "login-submit"} variant="primary" className="w-full" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submit2fa} className="mt-5 space-y-3">
            <p className="text-[12.5px] text-fg-2">Enter your authenticator code to finish signing in.</p>
            <Input className="!h-[34px] font-mono" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" />
            {error && (
              <p className="rounded border border-red-br bg-red-bg px-[12px] py-[10px] text-[12.5px] text-red" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" className="w-full" disabled={busy} type="submit">
              {busy ? "Verifying…" : "Verify"}
            </Button>
          </form>
        )}

        <div className="my-5 h-px bg-line" aria-hidden />
        <p className="micro-label mb-2">Demo accounts</p>
        <div className="flex flex-wrap gap-[6px]">
          {DEMOS.map((d) => (
            <button
              key={d.user}
              type="button"
              onClick={() => pickDoor(d.door, d.user)}
              className="rounded-[3px] border border-line-2 bg-panel-2 px-2 py-1 font-mono text-[11px] text-fg-2 transition-colors duration-120 hover:border-cyan-br hover:text-cyan"
            >
              {d.user}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
