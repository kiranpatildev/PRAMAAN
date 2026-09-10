"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState("sho_demo");
  const [password, setPassword] = useState("Pramaan123!");
  const [preToken, setPreToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api.login(username, password);
      if (data.two_factor_required) {
        setPreToken(data.pre_token);
      } else {
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!preToken) return;
    setBusy(true);
    setError("");
    try {
      await api.login2fa(preToken, code);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card">
        <h1 className="text-xl font-bold">{t("login.title", "Investigator login")}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Demo: <code>sho_demo</code> / <code>Pramaan123!</code>
        </p>
        {!preToken ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.username", "Username")} autoComplete="username" />
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.password", "Password")} autoComplete="current-password" />
            {error && <p className="text-sm text-risk-high">{error}</p>}
            <button className="btn w-full" disabled={busy} type="submit">
              {busy ? t("login.signing", "Signing in…") : t("login.signin", "Sign in")}
            </button>
          </form>
        ) : (
          <form onSubmit={submit2fa} className="mt-4 space-y-3">
            <p className="text-sm text-slate-400">{t("login.need2fa", "Enter your authenticator code")}</p>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder={t("login.code", "6-digit code")} inputMode="numeric" autoComplete="one-time-code" />
            {error && <p className="text-sm text-risk-high">{error}</p>}
            <button className="btn w-full" disabled={busy} type="submit">
              {t("login.verify", "Verify")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
