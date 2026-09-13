const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
export const API_BASE = API;

const ACCESS_KEY = "pramaan_access";
const REFRESH_KEY = "pramaan_refresh";
const REMEMBER_KEY = "pramaan_remember"; // "0" = this-session-only (sessionStorage)

/** Token store honors "Remember me": unchecked at login keeps tokens in
 *  sessionStorage so they die with the tab; default is localStorage. */
function tokenStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === "0"
      ? window.sessionStorage
      : window.localStorage;
  } catch {
    return null;
  }
}

export function setRememberMe(remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch { /* ignore */ }
}

function getAccess(): string | null {
  const s = tokenStore();
  return s ? s.getItem(ACCESS_KEY) : null;
}

function getRefresh(): string | null {
  // Refresh tokens live where the last login put them: check both stores.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REFRESH_KEY) ?? window.sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function storeTokens(access: string, refresh?: string) {
  const s = tokenStore();
  if (!s) return;
  try {
    s.setItem(ACCESS_KEY, access);
    if (refresh) {
      // Refresh token follows the access token's store.
      try {
        window.localStorage.removeItem(REFRESH_KEY);
        window.sessionStorage.removeItem(REFRESH_KEY);
      } catch { /* ignore */ }
      s.setItem(REFRESH_KEY, refresh);
    }
  } catch { /* ignore */ }
}

/** Clear the session and send the user back to login (client-side only). */
export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    for (const s of [window.localStorage, window.sessionStorage]) {
      s.removeItem(ACCESS_KEY);
      s.removeItem(REFRESH_KEY);
    }
    window.localStorage.removeItem("pramaan_role");
  } catch { /* ignore */ }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

/** Single-flight access-token refresh. Returns the new token, or null when
 *  the session is unrecoverable (refresh missing/expired/rejected). */
let refreshPromise: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refresh = getRefresh();
    if (!refresh) return null;
    try {
      const res = await fetch(`${API}/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.access) return null;
      storeTokens(data.access, data.refresh);
      return data.access as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

type FetchOpts = { noRetry?: boolean };

/** Authenticated fetch with automatic token refresh. On the first 401 it
 *  refreshes the access token once and retries; if the session is dead it
 *  clears it (redirecting to /login) and throws a user-safe error — raw
 *  backend messages like "Token is expired" never reach the UI. */
export async function apiFetch(url: string, init: RequestInit = {}, opts: FetchOpts = {}): Promise<Response> {
  const doFetch = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (!isForm && init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, { ...init, headers });
  };

  let res = await doFetch(getAccess());
  if (res.status !== 401 || opts.noRetry) return res;
  // Access token expired (or otherwise rejected): try one silent refresh.
  const fresh = await refreshAccessToken();
  if (!fresh) {
    clearSession();
    throw new Error("Session expired — please sign in again.");
  }
  res = await doFetch(fresh);
  if (res.status === 401) {
    clearSession();
    throw new Error("Session expired — please sign in again.");
  }
  return res;
}

export async function handle(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Session expired — please sign in again.");
    }
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/** Force-probe the session: refresh the access token now (used by the app
 *  shell on load so WS URLs and first paints use a live token). */
async function ensureFreshToken(): Promise<boolean> {
  if (!getRefresh()) return false;
  const fresh = await refreshAccessToken();
  return !!fresh;
}

export const api = {
  ensureFreshToken,
  logout() {
    clearSession();
  },
  async login(username: string, password: string, expected_role?: string) {
    const res = await apiFetch(`${API}/auth/login/`, {
      method: "POST",
      body: JSON.stringify({ username, password, ...(expected_role ? { expected_role } : {}) }),
    }, { noRetry: true });
    const data = await handle(res);
    if (typeof window !== "undefined" && data.access && data.refresh) {
      storeTokens(data.access, data.refresh);
    }
    return data;
  },
  async login2fa(pre_token: string, code: string) {
    const res = await apiFetch(`${API}/auth/login/2fa/`, {
      method: "POST",
      body: JSON.stringify({ pre_token, code }),
    }, { noRetry: true });
    const data = await handle(res);
    if (typeof window !== "undefined" && data.access && data.refresh) {
      storeTokens(data.access, data.refresh);
    }
    return data;
  },
  // 2FA client (dormant — no enrollment UI; login2fa serves legacy enabled
  // accounts via the server-driven second step; setup/verify/disable/status
  // kept so re-enabling 2FA later is backend+UI only).
  tfaStatus() {
    return apiFetch(`${API}/auth/2fa/status/`).then(handle);
  },
  tfaSetup() {
    return apiFetch(`${API}/auth/2fa/setup/`, { method: "POST" }).then(handle);
  },
  tfaVerify(code: string) {
    return apiFetch(`${API}/auth/2fa/verify/`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }).then(handle);
  },
  tfaDisable(password: string) {
    return apiFetch(`${API}/auth/2fa/disable/`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }).then(handle);
  },
};
