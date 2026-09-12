/** Typed fetch wrappers over apiFetch (token refresh lives in ./api).
 *  Shapes mirror the snake_case DRF serializers (see lib/types.ts). */
import { API_BASE, apiFetch, handle } from "./api";
import type {
  AlertItem, AssistantAnswer, AuditEntry, CaseItem, DashboardKpis, Evidence,
  GraphData, MergeSuggestion, Note, Paginated, ReviewRelation, SearchHit,
  Task, User,
} from "./types";

function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

function unwrap<T>(d: { results?: T } | T): T {
  return (d as { results?: T }).results ?? (d as T);
}

/* ---------------- auth ---------------- */

export function loginUser(username: string, password: string, expected_role?: string, use2fa?: boolean, otp?: string) {
  void use2fa;
  void otp;
  return import("./api").then(({ api }) => api.login(username, password, expected_role));
}

export function getMe(): Promise<User> {
  return apiFetch(`${API_BASE}/auth/me/`).then(handle);
}

export function listUsers(): Promise<User[]> {
  return apiFetch(`${API_BASE}/auth/users/`).then(handle).then((d) => unwrap<User[]>(d));
}

export function registerUser(data: Record<string, unknown>): Promise<User> {
  return apiFetch(`${API_BASE}/auth/register/`, {
    method: "POST",
    body: JSON.stringify(data),
  }).then(handle);
}

/* ---------------- cases ---------------- */

export interface CaseFilters {
  q?: string;
  status?: string;
  risk?: string;
  risk_level?: string;
  district?: string;
  ordering?: string;
  limit?: number;
  offset?: number;
  page?: number;
}

export async function listCases(f: CaseFilters = {}): Promise<{ count: number; results: CaseItem[] }> {
  const d = await apiFetch(`${API_BASE}/cases/${qs({ ...f })}`).then(handle);
  if (Array.isArray(d)) return { count: d.length, results: d };
  return { count: d.count ?? (d.results ?? []).length, results: d.results ?? [] };
}

export function getCase(id: string | number): Promise<CaseItem> {
  return apiFetch(`${API_BASE}/cases/${id}/`).then(handle);
}

export function createCase(data: Record<string, unknown>): Promise<CaseItem> {
  return apiFetch(`${API_BASE}/cases/`, { method: "POST", body: JSON.stringify(data) }).then(handle);
}

export function patchCase(id: string | number, data: Record<string, unknown>): Promise<CaseItem> {
  return apiFetch(`${API_BASE}/cases/${id}/`, { method: "PATCH", body: JSON.stringify(data) }).then(handle);
}

export function deleteCase(id: string | number): Promise<void> {
  return apiFetch(`${API_BASE}/cases/${id}/`, { method: "DELETE" }).then(() => undefined);
}

export function closeCase(id: string | number): Promise<CaseItem> {
  return apiFetch(`${API_BASE}/cases/${id}/close/`, { method: "POST" }).then(handle);
}

export function reopenCase(id: string | number): Promise<CaseItem> {
  return apiFetch(`${API_BASE}/cases/${id}/reopen/`, { method: "POST" }).then(handle);
}

export function assignCase(id: string | number, user_id: number, permission: string) {
  return apiFetch(`${API_BASE}/cases/${id}/assign/`, {
    method: "POST",
    body: JSON.stringify({ user_id, permission }),
  }).then(handle);
}

export function unassignCase(id: string | number, user_id: number) {
  return assignCase(id, user_id, "remove");
}

/* ---------------- dashboard ---------------- */

export function dashboardKpis(): Promise<DashboardKpis> {
  return apiFetch(`${API_BASE}/analytics/dashboard/`).then(handle);
}

/* ---------------- evidence ---------------- */

export async function listEvidence(caseId: string | number, limit = 200): Promise<Evidence[]> {
  const d = await apiFetch(`${API_BASE}/cases/${caseId}/evidence/${qs({ limit })}`).then(handle);
  return unwrap<Evidence[]>(d);
}

export function uploadEvidence(caseId: string | number, file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiFetch(`${API_BASE}/cases/${caseId}/evidence/`, { method: "POST", body: form }).then(handle);
}

export function deleteEvidence(caseId: string | number, id: number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/evidence/${id}/`, { method: "DELETE" }).then(() => undefined);
}

export function evidenceCustody(caseId: string | number, id: number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/evidence/${id}/custody/`).then(handle);
}

export function evidenceDownload(caseId: string | number, id: number): Promise<{ url: string }> {
  return apiFetch(`${API_BASE}/cases/${caseId}/evidence/${id}/download/`).then(handle);
}

export function reprocessEvidence(caseId: string | number, id: number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/evidence/${id}/reprocess/`, { method: "POST" }).then(handle);
}

/* ---------------- review (entities / relations / merges) ---------------- */

export function reviewEntities(caseId: string | number, status = "pending", limit = 500) {
  return apiFetch(`${API_BASE}/entities/review/entities/${qs({ case_id: caseId, status, limit })}`).then(handle).then((d) => unwrap<Record<string, unknown>[]>(d));
}

export function reviewRelations(caseId: string | number, status = "pending", limit = 500): Promise<ReviewRelation[]> {
  return apiFetch(`${API_BASE}/entities/review/relations/${qs({ case_id: caseId, status, limit })}`).then(handle).then((d) => unwrap<ReviewRelation[]>(d));
}

export function reviewMerges(caseId: string | number, status = "pending", limit = 200): Promise<MergeSuggestion[]> {
  return apiFetch(`${API_BASE}/entities/review/merges/${qs({ case_id: caseId, status, limit })}`).then(handle).then((d) => unwrap<MergeSuggestion[]>(d));
}

export interface ReviewQueue {
  entities: { count: number; results: Record<string, unknown>[] };
  relations: { count: number; results: Record<string, unknown>[] };
  merges: { count: number; results: Record<string, unknown>[] };
}

/** Cross-case pending queue, scoped server-side to visible cases. */
export function reviewQueue(status = "pending", limit = 50): Promise<ReviewQueue> {
  return apiFetch(`${API_BASE}/entities/review/queue/${qs({ status, limit })}`).then(handle);
}

export function decideEntity(id: number, decision: "confirm" | "reject") {
  return apiFetch(`${API_BASE}/entities/review/entities/${id}/`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  }).then(handle);
}

export function decideRelation(id: number, decision: "confirm" | "reject") {
  return apiFetch(`${API_BASE}/entities/review/relations/${id}/`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  }).then(handle);
}

export function decideMerge(id: number, decision: "approve" | "reject") {
  return apiFetch(`${API_BASE}/entities/review/merges/${id}/`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  }).then(handle);
}

/** Nested spec routes (backend aliases): confirm/reject a case entity. */
export function confirmEntity(caseId: string | number, eid: string | number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/entities/${eid}/confirm/`, { method: "POST" }).then(handle);
}

export function rejectEntity(caseId: string | number, eid: string | number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/entities/${eid}/reject/`, { method: "POST" }).then(handle);
}

/* ---------------- graph / timeline ---------------- */

export function caseGraph(id: string | number, params: Record<string, string | number> = {}): Promise<GraphData> {
  return apiFetch(`${API_BASE}/cases/${id}/graph/${qs(params)}`).then(handle);
}

export function caseRelationships(id: string | number): Promise<{ types: { type: string; count: number }[] }> {
  return apiFetch(`${API_BASE}/cases/${id}/relationships/`).then(handle);
}

export function expandGraph(id: string | number, node: string, depth = 1): Promise<GraphData> {
  return apiFetch(`${API_BASE}/cases/${id}/graph/expand/${qs({ node, depth })}`).then(handle);
}

export function buildGraph(id: string | number) {
  return apiFetch(`${API_BASE}/cases/${id}/graph/build/`, { method: "POST" }).then(handle);
}

export function caseTimeline(id: string | number) {
  return apiFetch(`${API_BASE}/cases/${id}/timeline/`).then(handle);
}

/* ---------------- snapshots ---------------- */

export function listSnapshots(caseId: string | number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/graph/snapshots/`).then(handle).then(unwrap<unknown[]>);
}

export function analyticsOverview(caseId: string | number) {
  return apiFetch(`${API_BASE}/analytics/case/${caseId}/overview/`).then(handle);
}

/* ---------------- analytics / cross-case / geo ---------------- */

export function crossCase(caseId?: string | number) {
  return apiFetch(`${API_BASE}/analytics/cross-case/${caseId ? qs({ case_id: caseId }) : ""}`).then(handle);
}

export function geoPoints(caseId: string | number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/geo/`).then(handle);
}

/* ---------------- assistant ---------------- */

export function assistantQuery(query: string, case_id?: string | number): Promise<AssistantAnswer> {
  return apiFetch(`${API_BASE}/assistant/query/`, {
    method: "POST",
    body: JSON.stringify({ query, ...(case_id ? { case_id } : {}) }),
  }).then(handle);
}

/* ---------------- unified search ---------------- */

export async function unifiedSearch(q: string): Promise<{ query: string; results: SearchHit[] }> {
  const d = await apiFetch(`${API_BASE}/search/${qs({ q })}`).then(handle);
  if (Array.isArray(d.results)) return { query: d.query ?? q, results: d.results };
  // Legacy grouped shape -> flatten into the unified array.
  const out: SearchHit[] = [];
  for (const c of d.cases ?? []) {
    out.push({ kind: "case", label: `${c.fir_no} — ${c.title}`, sub: c.status, caseId: c.id, case_id: c.id });
  }
  for (const e of d.evidence ?? []) {
    out.push({ kind: "evidence", label: e.file_name, sub: `${e.classification} · ${e.case_fir}`, caseId: e.case_id, case_id: e.case_id });
  }
  for (const e of d.entities ?? []) {
    out.push({ kind: "entity", label: e.value, sub: `${e.node_type} · ${e.case_fir}`, caseId: e.case_id, case_id: e.case_id });
  }
  return { query: d.query ?? q, results: out };
}

/* ---------------- alerts ---------------- */

export async function alertsFeed(): Promise<AlertItem[]> {
  const d = await apiFetch(`${API_BASE}/alerts/`).then(handle);
  return unwrap<AlertItem[]>(d);
}

export function dismissAlert(_id: number): Promise<void> {
  // Backend has no dismiss; marking the notification read is the equivalent.
  return apiFetch(`${API_BASE}/alerts/notifications/${_id}/read/`, { method: "POST" })
    .then(handle)
    .then(() => undefined)
    .catch(() => undefined);
}

export async function notifications(unread = false): Promise<unknown[]> {
  const d = await apiFetch(`${API_BASE}/alerts/notifications/${unread ? "?unread=1" : ""}`).then(handle);
  return unwrap<unknown[]>(d);
}

/* ---------------- reports ---------------- */

export function generatePackage(caseId: string | number) {
  return apiFetch(`${API_BASE}/reports/case-package/`, {
    method: "POST",
    body: JSON.stringify({ case_id: caseId }),
  }).then(handle);
}

export function reportDownloadBlob(id: number): Promise<Blob> {
  return apiFetch(`${API_BASE}/reports/${id}/download/`).then((r) => {
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.blob();
  });
}

/* ---------------- workflow ---------------- */

export async function caseTasks(caseId: string | number): Promise<Task[]> {
  const d = await apiFetch(`${API_BASE}/cases/${caseId}/tasks/`).then(handle);
  return unwrap<Task[]>(d);
}

export function createTask(caseId: string | number, data: Record<string, unknown>): Promise<Task> {
  return apiFetch(`${API_BASE}/cases/${caseId}/tasks/`, { method: "POST", body: JSON.stringify(data) }).then(handle);
}

export function patchTask(caseId: string | number, id: number, data: Record<string, unknown>) {
  return apiFetch(`${API_BASE}/cases/${caseId}/tasks/${id}/`, { method: "PATCH", body: JSON.stringify(data) }).then(handle);
}

export function deleteTask(caseId: string | number, id: number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/tasks/${id}/`, { method: "DELETE" }).then(() => undefined);
}

export async function caseComments(caseId: string | number): Promise<Note[]> {
  const d = await apiFetch(`${API_BASE}/cases/${caseId}/comments/`).then(handle);
  return unwrap<Note[]>(d);
}

export function postComment(caseId: string | number, text: string): Promise<Note> {
  return apiFetch(`${API_BASE}/cases/${caseId}/comments/`, { method: "POST", body: JSON.stringify({ text }) }).then(handle);
}

export function deleteComment(caseId: string | number, id: number) {
  return apiFetch(`${API_BASE}/cases/${caseId}/comments/${id}/`, { method: "DELETE" }).then(() => undefined);
}

export async function caseLinks(caseId: string | number) {
  const d = await apiFetch(`${API_BASE}/cases/${caseId}/links/`).then(handle);
  return unwrap(d);
}

export function caseActivity(caseId: string | number): Promise<{ activity: AuditEntry[] }> {
  return apiFetch(`${API_BASE}/cases/${caseId}/activity/`).then(handle);
}

/* ---------------- audit ---------------- */

export async function auditLog(): Promise<Paginated<AuditEntry>> {
  const d = await apiFetch(`${API_BASE}/audit/`).then(handle);
  if (Array.isArray(d)) return { count: d.length, results: d };
  return d;
}

/* ---------------- icjs ---------------- */

export function icjsAvailable(): Promise<{ cases: { case_id: string; title?: string }[] }> {
  return apiFetch(`${API_BASE}/icjs/available-cases/`).then(handle);
}

export function icjsImport(external_case_id: string) {
  return apiFetch(`${API_BASE}/cases/icjs-import/`, {
    method: "POST",
    body: JSON.stringify({ external_case_id }),
  }).then(handle);
}
