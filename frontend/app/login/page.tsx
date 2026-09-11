"use client";

/** PRAMAAN secure-portal login: full-bleed split screen.
 *  Left = brand/product story. Right = role toggle + credentials + 2FA.
 *  Auth logic (doors, demo path, 2FA, landing) is unchanged. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setRememberMe } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Icon } from "@/components/ui";

type Door = "sho" | "investigator";

const DOORS: { id: Door; title: string; sub: string; keyTitle: string; keySub: string }[] = [
  {
    id: "investigator", title: "Investigator",
    sub: "Evidence & Analysis",
    keyTitle: "login.doorInv" as const, keySub: "login.doorInvSub" as const,
  },
  {
    id: "sho", title: "SHO / Supervisor",
    sub: "Oversight & Approvals",
    keyTitle: "login.doorSho" as const, keySub: "login.doorShoSub" as const,
  },
];

const FEATURES = [
  { icon: "doc", label: "Multi-Source Data Integration" },
  { icon: "spark", label: "AI-Powered Analysis" },
  { icon: "network", label: "Criminal Network Mapping" },
  { icon: "eye", label: "Actionable Intelligence" },
];

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [door, setDoor] = useState<Door>("investigator");
  const [username, setUsername] = useState("inv_demo");
  const [password, setPassword] = useState("Pramaan123!");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [preToken, setPreToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function land(d: Door) {
    try {
      window.localStorage.setItem("pramaan_role", d);
    } catch { /* private mode — landing still works, accent falls back */ }
    router.push(d === "sho" ? "/dashboard" : "/my-cases");
  }

  function pick(d: Door) {
    setDoor(d);
    setError("");
    setPreToken(null);
    setCode("");
    setUsername(d === "sho" ? "sho_demo" : "inv_demo");
    setPassword("Pramaan123!");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setRememberMe(remember);
      const data = await api.login(username, password, door);
      if (data.two_factor_required) {
        setPreToken(data.pre_token);
      } else {
        land(door);
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
      land(door);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  function demo(d: Door) {
    pick(d);
    requestAnimationFrame(() => {
      document.getElementById(d === "sho" ? "login-submit-sho" : "login-submit-inv")?.closest("form")
        ?.requestSubmit();
    });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[55%_45%]">
      {/* ---------------- left: brand panel ---------------- */}
      <div className="relative hidden overflow-hidden lg:block">
        <div aria-hidden className="absolute inset-0 bg-[#0B0F17]">
          {/* map-grid texture */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(59 130 246 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(59 130 246 / 0.07) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(ellipse 85% 80% at 40% 45%, black 25%, transparent 78%)",
              WebkitMaskImage: "radial-gradient(ellipse 85% 80% at 40% 45%, black 25%, transparent 78%)",
            }}
          />
          {/* crosshair rings */}
          <div className="absolute left-[16%] top-[30%] h-72 w-72 rounded-full border border-[#3B82F6]/15" />
          <div className="absolute left-[16%] top-[30%] m-14 h-44 w-44 rounded-full border border-[#3B82F6]/20" />
          <div className="absolute left-[16%] top-[30%] m-[7.5rem] h-12 w-12 rounded-full border border-[#3B82F6]/30" />
          {/* glows */}
          <div className="absolute -left-24 top-1/4 h-96 w-96 rounded-full bg-[#3B82F6]/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#10B981]/5 blur-3xl" />
          {/* faint connector lines */}
          <svg className="absolute inset-0 h-full w-full opacity-20" aria-hidden>
            <line x1="16%" y1="30%" x2="70%" y2="12%" stroke="#3B82F6" strokeWidth="1" strokeDasharray="4 4" />
            <line x1="16%" y1="30%" x2="62%" y2="72%" stroke="#3B82F6" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx="70%" cy="12%" r="4" fill="none" stroke="#3B82F6" />
            <circle cx="62%" cy="72%" r="4" fill="none" stroke="#10B981" />
          </svg>
        </div>

        <p aria-hidden className="absolute right-6 top-6 font-mono text-[11px] tracking-[0.25em] text-[#8B93A1]/60">
          PEOPLE / PATTERNS / PLACES / PURPOSE
        </p>

        <div className="relative flex h-full flex-col justify-center px-14 py-12">
          <h1 className="text-5xl font-extrabold tracking-[0.18em] text-white">PRAMAAN</h1>
          <p className="mt-3 font-mono text-xs tracking-[0.3em] text-[#3B82F6]">
            INVESTIGATION INTELLIGENCE PLATFORM
          </p>
          <p className="mt-8 max-w-md text-2xl font-light italic leading-snug text-[#E5E7EB]/90">
            Connecting evidence.
            <br />
            Uncovering the bigger picture.
          </p>

          <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-center gap-2.5 rounded-lg border border-[#1F2733] bg-[#121826]/80 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#3B82F6]/12 text-[#3B82F6]">
                  <Icon name={f.icon} className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium leading-tight text-[#E5E7EB]">{f.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex items-end justify-between pt-12">
            <p className="text-sm italic text-[#8B93A1]">“Safer Communities. Stronger India.”</p>
            <p className="font-mono text-[11px] tracking-widest text-[#8B93A1]/70">BUILT FOR A SAFER TOMORROW</p>
          </div>
        </div>
      </div>

      {/* ---------------- right: login card ---------------- */}
      <div className="relative flex items-center justify-center bg-[#0B0F17] px-6 py-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 right-10 h-64 w-64 rounded-full bg-[#3B82F6]/8 blur-3xl" />
        </div>

        <div className="relative w-full" style={{ maxWidth: 400 }}>
          <div className="mb-5 flex items-center justify-between">
            <span className="lg:hidden">
              <span className="text-lg font-extrabold tracking-[0.18em]">PRAMAAN</span>
              <span className="ml-2 font-mono text-[10px] tracking-[0.2em] text-[#3B82F6]">IIP</span>
            </span>
            <span className="hidden lg:inline-block" />
            <span className="flex items-center gap-2 font-mono text-[11px] text-[#8B93A1]">
              <span>v2.4</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1F2733] px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                Secure Portal
              </span>
            </span>
          </div>

          <div className="rounded-lg border border-[#1F2733] bg-[#121826] p-6 sm:p-7">
            {!preToken ? (
              <>
                <h2 className="text-xl font-bold">Welcome to PRAMAAN</h2>
                <p className="mt-1 text-sm text-[#8B93A1]">Sign in to continue</p>

                <div className="mt-5 grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Login role">
                  {DOORS.map((d) => {
                    const active = door === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => pick(d.id)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? "border-[#3B82F6] bg-[#3B82F6]/10"
                            : "border-[#1F2733] bg-[#0B0F17] hover:border-[#8B93A1]"
                        }`}
                      >
                        <Icon name={d.id === "sho" ? "shield" : "user"} className={`h-5 w-5 ${active ? "text-[#3B82F6]" : "text-[#8B93A1]"}`} />
                        <span className="mt-2 block text-[13px] font-bold leading-tight">{t(d.keyTitle, d.title)}</span>
                        <span className="mt-0.5 block text-[11px] leading-tight text-[#8B93A1]">{t(d.keySub, d.sub)}</span>
                      </button>
                    );
                  })}
                </div>

                <form onSubmit={submit} className="mt-5 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#8B93A1]" htmlFor="login-username">
                      {t("login.username", "Username")}
                    </label>
                    <div className="relative">
                      <Icon name="user" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8B93A1]" />
                      <input id="login-username" className="input !pl-9" value={username}
                        onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#8B93A1]" htmlFor="login-password">
                      {t("login.password", "Password")}
                    </label>
                    <div className="relative">
                      <Icon name="lock" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8B93A1]" />
                      <input id="login-password" className="input !pl-9 !pr-10" type={showPw ? "text" : "password"}
                        value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                      <button type="button" onClick={() => setShowPw((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B93A1] hover:text-[#E5E7EB]"
                        aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}>
                        <Icon name={showPw ? "eyeOff" : "eye"} className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[#8B93A1]">
                      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-[#3B82F6]" />
                      Remember me
                    </label>
                    <span className="text-[#8B93A1]/70" title="Password resets are handled by your SHO or system administrator">
                      Forgot password?
                    </span>
                  </div>

                  {error && <p className="text-sm text-[#EF4444]">{error}</p>}

                  <button id={door === "sho" ? "login-submit-sho" : "login-submit-inv"}
                    className="btn w-full" disabled={busy} type="submit">
                    {busy ? t("login.signing", "Signing in…") : <>{t("login.signin", "Sign in")} <Icon name="arrowR" className="h-4 w-4" /></>}
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3 text-[11px] text-[#8B93A1]">
                  <span className="h-px flex-1 bg-[#1F2733]" /> OR <span className="h-px flex-1 bg-[#1F2733]" />
                </div>

                <button type="button" disabled
                  title="Police SSO is not configured in this deployment"
                  className="btn-ghost w-full cursor-not-allowed opacity-60">
                  <Icon name="idcard" className="h-4 w-4" />
                  Sign in with Police SSO
                  <Icon name="chevR" className="h-4 w-4" />
                </button>

                <div className="mt-4 flex items-center justify-center gap-3 text-[11px]">
                  <button type="button" onClick={() => demo("investigator")} className="text-[#8B93A1] hover:text-[#3B82F6] hover:underline">
                    {t("login.demoInv", "Continue as Investigator (Demo) →")}
                  </button>
                  <span className="text-[#1F2733]">|</span>
                  <button type="button" onClick={() => demo("sho")} className="text-[#8B93A1] hover:text-[#3B82F6] hover:underline">
                    {t("login.demoSho", "Continue as Supervisor (Demo) →")}
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={submit2fa} className="space-y-3">
                <h2 className="text-xl font-bold">Two-factor check</h2>
                <p className="text-sm text-[#8B93A1]">{t("login.need2fa", "Enter your authenticator code")}</p>
                <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder={t("login.code", "6-digit code")} inputMode="numeric" autoComplete="one-time-code" />
                {error && <p className="text-sm text-[#EF4444]">{error}</p>}
                <button className="btn w-full" disabled={busy} type="submit">
                  {t("login.verify", "Verify")}
                </button>
              </form>
            )}
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-[#8B93A1]">
            <Icon name="shield" className="h-3.5 w-3.5" />
            This is a secured system. Unauthorized access is prohibited.
          </p>
        </div>
      </div>
    </div>
  );
}
