"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Self-service TOTP two-factor management. */
export function SecurityCard() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.tfaStatus().then((d) => setEnabled(!!d.totp_enabled)).catch(() => setEnabled(false));
  }, []);

  async function setup() {
    setError("");
    try {
      const d = await api.tfaSetup();
      setSecret(d.secret);
      setUri(d.otpauth_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    }
  }

  async function verify() {
    setError("");
    try {
      await api.tfaVerify(code);
      setEnabled(true);
      setSecret("");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid code");
    }
  }

  async function disable() {
    setError("");
    try {
      await api.tfaDisable(password);
      setEnabled(false);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disable failed (check password)");
    }
  }

  return (
    <div className="card">
      <h2 className="font-semibold">
        {t("security.title", "Two-factor authentication")}{" "}
        {enabled !== null && (
          <span className={`text-xs ${enabled ? "text-risk-low" : "text-slate-400"}`}>
            {enabled ? t("security.on", "enabled") : t("security.off", "disabled")}
          </span>
        )}
      </h2>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      {enabled === false && !secret && (
        <button className="btn mt-2 !px-3 !py-1 text-xs" onClick={setup}>Enable 2FA</button>
      )}
      {enabled === false && secret && (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-slate-400">Add this key to your authenticator app, then verify:</p>
          <code className="block break-all rounded bg-ink-950 p-2 text-xs text-accent">{secret}</code>
          <p className="break-all text-xs text-slate-500">{uri}</p>
          <div className="flex gap-2">
            <input className="input" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            <button className="btn" onClick={verify}>Verify</button>
          </div>
        </div>
      )}
      {enabled === true && (
        <div className="mt-2 flex gap-2">
          <input className="input" type="password" placeholder="Confirm password to disable" value={password}
            onChange={(e) => setPassword(e.target.value)} />
          <button className="btn !bg-risk-high" onClick={disable}>Disable</button>
        </div>
      )}
    </div>
  );
}
