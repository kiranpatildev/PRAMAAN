const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

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
async function apiFetch(url: string, init: RequestInit = {}, opts: FetchOpts = {}): Promise<Response> {
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

async function handle(res: Response) {
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
  me() {
    return apiFetch(`${API}/auth/me/`).then(handle);
  },
  cases(params = "") {
    return apiFetch(`${API}/cases/${params}`).then(handle);
  },
  assignCase(id: string | number, user_id: number, permission: string) {
    return apiFetch(`${API}/cases/${id}/assign/`, {
      method: "POST",
      body: JSON.stringify({ user_id, permission }),
    }).then(handle);
  },
  users() {
    return apiFetch(`${API}/auth/users/`).then(handle);
  },
  caseGraph(id: string | number, params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
        if (v !== "" && v !== undefined && v !== null) acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
    return apiFetch(`${API}/cases/${id}/graph/${qs ? `?${qs}` : ""}`).then(handle);
  },
  expandGraph(id: string | number, node: string, depth = 1) {
    return apiFetch(
      `${API}/cases/${id}/graph/expand/?node=${encodeURIComponent(node)}&depth=${depth}`
    ).then(handle);
  },
  evidenceDetail(caseId: string | number, evidenceId: number | string) {
    return apiFetch(`${API}/cases/${caseId}/evidence/${evidenceId}/`).then(handle);
  },
  caseTimeline(id: string | number) {
    return apiFetch(`${API}/cases/${id}/timeline/`).then(handle);
  },
  snapshots(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/graph/snapshots/`).then(handle);
  },
  saveSnapshot(caseId: string | number, label: string, filters: Record<string, unknown>) {
    return apiFetch(`${API}/cases/${caseId}/graph/snapshots/`, {
      method: "POST",
      body: JSON.stringify({ label, ...filters }),
    }).then(handle);
  },
  snapshotDetail(caseId: string | number, snapId: number) {
    return apiFetch(`${API}/cases/${caseId}/graph/snapshots/${snapId}/`).then(handle);
  },
  deleteSnapshot(caseId: string | number, snapId: number) {
    return apiFetch(`${API}/cases/${caseId}/graph/snapshots/${snapId}/`, {
      method: "DELETE",
    }).then(handle);
  },
  snapshotDiff(caseId: string | number, a: number, b: number) {
    return apiFetch(`${API}/cases/${caseId}/graph/snapshots/diff/?a=${a}&b=${b}`).then(handle);
  },
  analyticsOverview(caseId: string | number) {
    return apiFetch(`${API}/analytics/case/${caseId}/overview/`).then(handle);
  },
  analyticsRisk(caseId: string | number) {
    return apiFetch(`${API}/analytics/case/${caseId}/risk/`).then(handle);
  },
  riskHistory(caseId: string | number) {
    return apiFetch(`${API}/analytics/case/${caseId}/risk/history/`).then(handle);
  },
  analyticsAnomalies(caseId: string | number) {
    return apiFetch(`${API}/analytics/case/${caseId}/anomalies/`).then(handle);
  },
  crossCase() {
    return apiFetch(`${API}/analytics/cross-case/`).then(handle);
  },
  analyticsCompare(caseId: string | number, from: string, to: string) {
    return apiFetch(`${API}/analytics/case/${caseId}/compare/?from=${from}&to=${to}`).then(handle);
  },
  caseEvidence(id: string | number) {
    return apiFetch(`${API}/cases/${id}/evidence/`).then(handle);
  },
  uploadEvidence(id: string | number, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return apiFetch(`${API}/cases/${id}/evidence/`, {
      method: "POST",
      // no Content-Type: browser sets multipart boundary
      body: form,
    }).then(handle);
  },
  evidenceCustody(caseId: string | number, evidenceId: number) {
    return apiFetch(`${API}/cases/${caseId}/evidence/${evidenceId}/custody/`).then(handle);
  },
  evidenceDownload(caseId: string | number, evidenceId: number) {
    return apiFetch(`${API}/cases/${caseId}/evidence/${evidenceId}/download/`).then(handle);
  },
  reprocessEvidence(caseId: string | number, evidenceId: number) {
    return apiFetch(`${API}/cases/${caseId}/evidence/${evidenceId}/reprocess/`, {
      method: "POST",
    }).then(handle);
  },
  reviewEntities(caseId: string | number, status = "pending") {
    return apiFetch(`${API}/entities/review/entities/?case_id=${caseId}&status=${status}`).then(handle);
  },
  decideEntity(id: number, decision: "confirm" | "reject") {
    return apiFetch(`${API}/entities/review/entities/${id}/`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  reviewRelations(caseId: string | number, status = "pending") {
    return apiFetch(`${API}/entities/review/relations/?case_id=${caseId}&status=${status}`).then(handle);
  },
  decideRelation(id: number, decision: "confirm" | "reject") {
    return apiFetch(`${API}/entities/review/relations/${id}/`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  reviewMerges(caseId: string | number, status = "pending") {
    return apiFetch(`${API}/entities/review/merges/?case_id=${caseId}&status=${status}`).then(handle);
  },
  decideMerge(id: number, decision: "approve" | "reject") {
    return apiFetch(`${API}/entities/review/merges/${id}/`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  buildGraph(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/graph/build/`, {
      method: "POST",
    }).then(handle);
  },
  copilot(question: string, caseId?: string | number) {
    return apiFetch(`${API}/copilot/query/`, {
      method: "POST",
      body: JSON.stringify({ question, ...(caseId ? { case_id: caseId } : {}) }),
    }).then(handle);
  },
  globalSearch(q: string, extra: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q, ...extra }).toString();
    return apiFetch(`${API}/search/?${qs}`).then(handle);
  },
  alertsFeed(params = "") {
    return apiFetch(`${API}/alerts/${params}`).then(handle);
  },
  notifications(unread = false, channel = "") {
    const qs = new URLSearchParams({
      ...(unread ? { unread: "1" } : {}),
      ...(channel ? { channel } : {}),
    }).toString();
    return apiFetch(`${API}/alerts/notifications/${qs ? `?${qs}` : ""}`).then(handle);
  },
  markNotification(id: number) {
    return apiFetch(`${API}/alerts/notifications/${id}/read/`, {
      method: "POST",
    }).then(handle);
  },
  markAllNotifications() {
    return apiFetch(`${API}/alerts/notifications/read-all/`, {
      method: "POST",
    }).then(handle);
  },
  alertRules() {
    return apiFetch(`${API}/alerts/rules/`).then(handle);
  },
  createRule(data: Record<string, unknown>) {
    return apiFetch(`${API}/alerts/rules/`, {
      method: "POST",
      body: JSON.stringify(data),
    }).then(handle);
  },
  patchRule(id: number, data: Record<string, unknown>) {
    return apiFetch(`${API}/alerts/rules/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }).then(handle);
  },
  deleteRule(id: number) {
    return apiFetch(`${API}/alerts/rules/${id}/`, {
      method: "DELETE",
    }).then(handle);
  },
  geoPoints(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/geo/`).then(handle);
  },
  geoMovements(caseId: string | number, person: string) {
    return apiFetch(`${API}/cases/${caseId}/geo/movements/?person=${encodeURIComponent(person)}`).then(handle);
  },
  geoNearby(caseId: string | number, params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`${API}/cases/${caseId}/geo/nearby/?${qs}`).then(handle);
  },
  locateEntity(id: number, latitude: number, longitude: number) {
    return apiFetch(`${API}/entities/review/entities/${id}/locate/`, {
      method: "PATCH",
      body: JSON.stringify({ latitude, longitude }),
    }).then(handle);
  },
  reports(caseId?: string | number) {
    return apiFetch(`${API}/reports/${caseId ? `?case_id=${caseId}` : ""}`).then(handle);
  },
  generatePackage(caseId: string | number) {
    return apiFetch(`${API}/reports/case-package/`, {
      method: "POST",
      body: JSON.stringify({ case_id: caseId }),
    }).then(handle);
  },
  reportDownload(id: number) {
    return apiFetch(`${API}/reports/${id}/download/`).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.blob();
    });
  },
  caseTasks(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/tasks/`).then(handle);
  },
  createTask(caseId: string | number, data: Record<string, unknown>) {
    return apiFetch(`${API}/cases/${caseId}/tasks/`, {
      method: "POST",
      body: JSON.stringify(data),
    }).then(handle);
  },
  patchTask(caseId: string | number, id: number, data: Record<string, unknown>) {
    return apiFetch(`${API}/cases/${caseId}/tasks/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }).then(handle);
  },
  deleteTask(caseId: string | number, id: number) {
    return apiFetch(`${API}/cases/${caseId}/tasks/${id}/`, {
      method: "DELETE",
    }).then(handle);
  },
  caseComments(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/comments/`).then(handle);
  },
  postComment(caseId: string | number, text: string) {
    return apiFetch(`${API}/cases/${caseId}/comments/`, {
      method: "POST",
      body: JSON.stringify(text),
    }).then(handle);
  },
  deleteComment(caseId: string | number, id: number) {
    return apiFetch(`${API}/cases/${caseId}/comments/${id}/`, {
      method: "DELETE",
    }).then(handle);
  },
  caseLinks(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/links/`).then(handle);
  },
  createLink(caseId: string | number, to_case: number, reason: string) {
    return apiFetch(`${API}/cases/${caseId}/links/`, {
      method: "POST",
      body: JSON.stringify({ to_case, reason }),
    }).then(handle);
  },
  deleteLink(caseId: string | number, id: number) {
    return apiFetch(`${API}/cases/${caseId}/links/${id}/`, {
      method: "DELETE",
    }).then(handle);
  },
  caseActivity(caseId: string | number) {
    return apiFetch(`${API}/cases/${caseId}/activity/`).then(handle);
  },
  districts() {
    return apiFetch(`${API}/analytics/districts/`).then(handle);
  },
  district(name: string) {
    return apiFetch(`${API}/analytics/district/?district=${encodeURIComponent(name)}`).then(handle);
  },
  icjsAvailableCases() {
    return apiFetch(`${API}/icjs/available-cases/`).then(handle);
  },
  icjsImportCase(external_case_id: string) {
    return apiFetch(`${API}/cases/icjs-import/`, {
      method: "POST",
      body: JSON.stringify({ external_case_id }),
    }).then(handle);
  },
  createCase(data: Record<string, unknown>) {
    return apiFetch(`${API}/cases/`, {
      method: "POST",
      body: JSON.stringify(data),
    }).then(handle);
  },
};
