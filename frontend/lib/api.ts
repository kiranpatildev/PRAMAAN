const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return { "Content-Type": "application/json" };
  const token = window.localStorage.getItem("pramaan_access");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authOnlyHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("pramaan_access");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

export const api = {
  async login(username: string, password: string) {
    const res = await fetch(`${API}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await handle(res);
    if (typeof window !== "undefined" && data.access && data.refresh) {
      window.localStorage.setItem("pramaan_access", data.access);
      window.localStorage.setItem("pramaan_refresh", data.refresh);
    }
    return data;
  },
  async login2fa(pre_token: string, code: string) {
    const res = await fetch(`${API}/auth/login/2fa/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pre_token, code }),
    });
    const data = await handle(res);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("pramaan_access", data.access);
      window.localStorage.setItem("pramaan_refresh", data.refresh);
    }
    return data;
  },
  tfaStatus() {
    return fetch(`${API}/auth/2fa/status/`, { headers: authHeaders() }).then(handle);
  },
  tfaSetup() {
    return fetch(`${API}/auth/2fa/setup/`, { method: "POST", headers: authHeaders() }).then(handle);
  },
  tfaVerify(code: string) {
    return fetch(`${API}/auth/2fa/verify/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ code }),
    }).then(handle);
  },
  tfaDisable(password: string) {
    return fetch(`${API}/auth/2fa/disable/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ password }),
    }).then(handle);
  },
  me() {
    return fetch(`${API}/auth/me/`, { headers: authHeaders() }).then(handle);
  },
  cases(params = "") {
    return fetch(`${API}/cases/${params}`, { headers: authHeaders() }).then(handle);
  },
  caseGraph(id: string | number, params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
        if (v !== "" && v !== undefined && v !== null) acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
    return fetch(`${API}/cases/${id}/graph/${qs ? `?${qs}` : ""}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  expandGraph(id: string | number, node: string, depth = 1) {
    return fetch(
      `${API}/cases/${id}/graph/expand/?node=${encodeURIComponent(node)}&depth=${depth}`,
      { headers: authHeaders() }
    ).then(handle);
  },
  evidenceDetail(caseId: string | number, evidenceId: number | string) {
    return fetch(`${API}/cases/${caseId}/evidence/${evidenceId}/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  caseTimeline(id: string | number) {
    return fetch(`${API}/cases/${id}/timeline/`, { headers: authHeaders() }).then(handle);
  },
  snapshots(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/graph/snapshots/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  saveSnapshot(caseId: string | number, label: string, filters: Record<string, unknown>) {
    return fetch(`${API}/cases/${caseId}/graph/snapshots/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ label, ...filters }),
    }).then(handle);
  },
  snapshotDetail(caseId: string | number, snapId: number) {
    return fetch(`${API}/cases/${caseId}/graph/snapshots/${snapId}/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  deleteSnapshot(caseId: string | number, snapId: number) {
    return fetch(`${API}/cases/${caseId}/graph/snapshots/${snapId}/`, {
      method: "DELETE",
      headers: authOnlyHeaders(),
    }).then(handle);
  },
  snapshotDiff(caseId: string | number, a: number, b: number) {
    return fetch(`${API}/cases/${caseId}/graph/snapshots/diff/?a=${a}&b=${b}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  analyticsOverview(caseId: string | number) {
    return fetch(`${API}/analytics/case/${caseId}/overview/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  analyticsRisk(caseId: string | number) {
    return fetch(`${API}/analytics/case/${caseId}/risk/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  riskHistory(caseId: string | number) {
    return fetch(`${API}/analytics/case/${caseId}/risk/history/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  analyticsAnomalies(caseId: string | number) {
    return fetch(`${API}/analytics/case/${caseId}/anomalies/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  crossCase() {
    return fetch(`${API}/analytics/cross-case/`, { headers: authHeaders() }).then(handle);
  },
  analyticsCompare(caseId: string | number, from: string, to: string) {
    return fetch(`${API}/analytics/case/${caseId}/compare/?from=${from}&to=${to}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  caseEvidence(id: string | number) {
    return fetch(`${API}/cases/${id}/evidence/`, { headers: authHeaders() }).then(handle);
  },
  uploadEvidence(id: string | number, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return fetch(`${API}/cases/${id}/evidence/`, {
      method: "POST",
      headers: authOnlyHeaders(), // no Content-Type: browser sets multipart boundary
      body: form,
    }).then(handle);
  },
  evidenceCustody(caseId: string | number, evidenceId: number) {
    return fetch(`${API}/cases/${caseId}/evidence/${evidenceId}/custody/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  evidenceDownload(caseId: string | number, evidenceId: number) {
    return fetch(`${API}/cases/${caseId}/evidence/${evidenceId}/download/`, {
      headers: authHeaders(),
    }).then(handle);
  },
  reprocessEvidence(caseId: string | number, evidenceId: number) {
    return fetch(`${API}/cases/${caseId}/evidence/${evidenceId}/reprocess/`, {
      method: "POST",
      headers: authHeaders(),
    }).then(handle);
  },
  reviewEntities(caseId: string | number, status = "pending") {
    return fetch(`${API}/entities/review/entities/?case_id=${caseId}&status=${status}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  decideEntity(id: number, decision: "confirm" | "reject") {
    return fetch(`${API}/entities/review/entities/${id}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  reviewRelations(caseId: string | number, status = "pending") {
    return fetch(`${API}/entities/review/relations/?case_id=${caseId}&status=${status}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  decideRelation(id: number, decision: "confirm" | "reject") {
    return fetch(`${API}/entities/review/relations/${id}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  reviewMerges(caseId: string | number, status = "pending") {
    return fetch(`${API}/entities/review/merges/?case_id=${caseId}&status=${status}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  decideMerge(id: number, decision: "approve" | "reject") {
    return fetch(`${API}/entities/review/merges/${id}/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ decision }),
    }).then(handle);
  },
  buildGraph(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/graph/build/`, {
      method: "POST",
      headers: authHeaders(),
    }).then(handle);
  },
  copilot(question: string, caseId?: string | number) {
    return fetch(`${API}/copilot/query/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ question, ...(caseId ? { case_id: caseId } : {}) }),
    }).then(handle);
  },
  globalSearch(q: string, extra: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q, ...extra }).toString();
    return fetch(`${API}/search/?${qs}`, { headers: authHeaders() }).then(handle);
  },
  alertsFeed(params = "") {
    return fetch(`${API}/alerts/${params}`, { headers: authHeaders() }).then(handle);
  },
  notifications(unread = false, channel = "") {
    const qs = new URLSearchParams({
      ...(unread ? { unread: "1" } : {}),
      ...(channel ? { channel } : {}),
    }).toString();
    return fetch(`${API}/alerts/notifications/${qs ? `?${qs}` : ""}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  markNotification(id: number) {
    return fetch(`${API}/alerts/notifications/${id}/read/`, {
      method: "POST",
      headers: authHeaders(),
    }).then(handle);
  },
  markAllNotifications() {
    return fetch(`${API}/alerts/notifications/read-all/`, {
      method: "POST",
      headers: authHeaders(),
    }).then(handle);
  },
  alertRules() {
    return fetch(`${API}/alerts/rules/`, { headers: authHeaders() }).then(handle);
  },
  createRule(data: Record<string, unknown>) {
    return fetch(`${API}/alerts/rules/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(handle);
  },
  patchRule(id: number, data: Record<string, unknown>) {
    return fetch(`${API}/alerts/rules/${id}/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(handle);
  },
  deleteRule(id: number) {
    return fetch(`${API}/alerts/rules/${id}/`, {
      method: "DELETE",
      headers: authOnlyHeaders(),
    }).then(handle);
  },
  geoPoints(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/geo/`, { headers: authHeaders() }).then(handle);
  },
  geoMovements(caseId: string | number, person: string) {
    return fetch(`${API}/cases/${caseId}/geo/movements/?person=${encodeURIComponent(person)}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  geoNearby(caseId: string | number, params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${API}/cases/${caseId}/geo/nearby/?${qs}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  locateEntity(id: number, latitude: number, longitude: number) {
    return fetch(`${API}/entities/review/entities/${id}/locate/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ latitude, longitude }),
    }).then(handle);
  },
  reports(caseId?: string | number) {
    return fetch(`${API}/reports/${caseId ? `?case_id=${caseId}` : ""}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  generatePackage(caseId: string | number) {
    return fetch(`${API}/reports/case-package/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ case_id: caseId }),
    }).then(handle);
  },
  reportDownload(id: number) {
    return fetch(`${API}/reports/${id}/download/`, { headers: authOnlyHeaders() }).then((r) => {
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.blob();
    });
  },
  caseTasks(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/tasks/`, { headers: authHeaders() }).then(handle);
  },
  createTask(caseId: string | number, data: Record<string, unknown>) {
    return fetch(`${API}/cases/${caseId}/tasks/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(handle);
  },
  patchTask(caseId: string | number, id: number, data: Record<string, unknown>) {
    return fetch(`${API}/cases/${caseId}/tasks/${id}/`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(handle);
  },
  deleteTask(caseId: string | number, id: number) {
    return fetch(`${API}/cases/${caseId}/tasks/${id}/`, {
      method: "DELETE",
      headers: authOnlyHeaders(),
    }).then(handle);
  },
  caseComments(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/comments/`, { headers: authHeaders() }).then(handle);
  },
  postComment(caseId: string | number, text: string) {
    return fetch(`${API}/cases/${caseId}/comments/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    }).then(handle);
  },
  deleteComment(caseId: string | number, id: number) {
    return fetch(`${API}/cases/${caseId}/comments/${id}/`, {
      method: "DELETE",
      headers: authOnlyHeaders(),
    }).then(handle);
  },
  caseLinks(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/links/`, { headers: authHeaders() }).then(handle);
  },
  createLink(caseId: string | number, to_case: number, reason: string) {
    return fetch(`${API}/cases/${caseId}/links/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_case, reason }),
    }).then(handle);
  },
  deleteLink(caseId: string | number, id: number) {
    return fetch(`${API}/cases/${caseId}/links/${id}/`, {
      method: "DELETE",
      headers: authOnlyHeaders(),
    }).then(handle);
  },
  caseActivity(caseId: string | number) {
    return fetch(`${API}/cases/${caseId}/activity/`, { headers: authHeaders() }).then(handle);
  },
  districts() {
    return fetch(`${API}/analytics/districts/`, { headers: authHeaders() }).then(handle);
  },
  district(name: string) {
    return fetch(`${API}/analytics/district/?district=${encodeURIComponent(name)}`, {
      headers: authHeaders(),
    }).then(handle);
  },
  icjsAvailableCases() {
    return fetch(`${API}/icjs/available-cases/`, { headers: authHeaders() }).then(handle);
  },
  icjsImport(caseId: string | number, external_case_id: string) {
    return fetch(`${API}/cases/${caseId}/icjs-import/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ external_case_id }),
    }).then(handle);
  },
};
