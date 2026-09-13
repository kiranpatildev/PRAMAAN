/** Shared DTOs. The backend speaks snake_case, so these types mirror the
 *  DRF serializers exactly (§11 permits mirroring snake_case; nothing mixes). */

export type Role = "sho" | "investigator" | "admin";

export interface User {
  id: number;
  username: string;
  email?: string;
  role: Role;
  phone?: string;
  first_name?: string;
  last_name?: string;
  // Convenience projections used by shell/footer (derived client-side).
  name?: string;
  zone?: string;
  unit?: string;
}

export type EntityType =
  | "person" | "phone" | "vehicle" | "location"
  | "organization" | "transaction" | "case"
  | "Person" | "PhoneNumber" | "Vehicle" | "Location" | "Organization" | "Event";

export type EntityState = "confirmed" | "pending" | "rejected" | "CONFIRMED" | "PENDING" | "REJECTED";

export interface Entity {
  id: number | string;
  node_type: EntityType | string;
  type?: EntityType | string;
  label?: string;
  value?: string;
  alias?: string;
  normalized?: string;
  conf?: number;
  confidence?: number;
  state?: EntityState | string;
  status?: string;
  conn?: number;
  mention_count?: number;
  degree?: number;
  cases?: number;
  case_count?: number;
  lastObs?: string;
  evidence_file?: string;
  engine?: string;
  native_snippet?: string;
  detected_language?: string;
}

export interface Evidence {
  id: number;
  file_name: string;
  file?: string;
  file_type: string;
  type?: string;
  mime_type?: string;
  size_bytes?: number;
  size?: string;
  sha256?: string;
  classification?: string;
  classification_confidence?: number;
  ocr_status: string;
  status?: string;
  ocr_engine?: string;
  ocr_pages?: number;
  detected_language?: string;
  detected_language_confidence?: number;
  extraction_status?: string;
  processing_error?: string;
  created_at: string;
  uploaded?: string;
  uploaded_by?: string | null;
  by?: string;
  source?: string;
}

export interface TimelineEvent {
  id?: string | number;
  from?: string;
  to?: string;
  label?: string;
  valid_from?: string;
  date?: string;
  time?: string;
  type?: "COMMUNICATION" | "TRANSACTION" | "LOCATION" | "VEHICLE" | "REPORT" | string;
  title?: string;
  desc?: string;
  snippet?: string;
  ents?: string[];
  source?: string;
  source_evidence_id?: number | string | null;
  confidence?: number;
}

export interface CaseAssignment {
  id: number;
  user: User;
  permission: string;
  created_at?: string;
}

export interface CaseItem {
  id: number;
  fir_no: string;
  fir?: string;
  title: string;
  summary?: string;
  description?: string;
  status: string;
  risk_level: string;
  risk?: string;
  station?: string;
  district?: string;
  state?: string;
  owner?: User;
  assignments?: CaseAssignment[];
  team?: string[];
  entities_count?: number;
  evidence_count?: number;
  alerts_count?: number;
  relations_count?: number;
  progress?: { upload: boolean; extract: boolean; verify: boolean; network: boolean };
  relCounts?: Record<string, number>;
  created?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Note {
  id: number;
  author_name?: string;
  by?: string;
  text: string;
  created_at: string;
  at?: string;
}

export interface Task {
  id: number;
  title?: string;
  text?: string;
  description?: string;
  assignee?: number | null;
  assignee_name?: string;
  status: string;
  due_date?: string | null;
  due?: string;
}

export interface AuditEntry {
  id?: number;
  action: string;
  actor?: string;
  who?: string;
  initials?: string;
  object_type?: string;
  object_id?: number | string;
  target_type?: string;
  target_id?: number | string;
  before?: unknown;
  after?: unknown;
  at?: string;
  ts?: string;
  timestamp?: string;
  kind?: string;
  text?: string;
}

export interface Paginated<T> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  confidence?: number;
  cluster?: string;
  cluster_label?: string;
  source_evidence_id?: number | string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence?: number;
  soft?: boolean;
  source_evidence_id?: number | string | null;
  snippet?: string;
}

export interface GraphCluster {
  id: string;
  label: string;
  members?: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: GraphCluster[];
  case_id?: number;
  live?: boolean;
}

export interface DashboardKpis {
  cases_total: number;
  cases_open: number;
  evidence_files: number;
  evidence_in_pipeline: number;
  entities_extracted: number;
  entities_pending: number;
  high_risk_cases: number;
}

export type SearchKind = "case" | "evidence" | "entity";

export interface SearchHit {
  kind: SearchKind;
  label: string;
  sub?: string;
  caseId?: number;
  case_id?: number;
}

export interface AssistantAnswer {
  answer: string;
  citations?: { evidence_id?: number | string; file_name?: string; case_fir?: string; snippet?: string; score?: number }[];
  intent?: string;
  generated?: boolean;
  model?: string;
}

export interface GraphQueryAnswer {
  question?: string;
  intent?: string;
  generated?: boolean;
  unanswerable: boolean;
  answer_text: string;
  node_ids: string[];
  edge_ids: string[];
  rows?: Record<string, unknown>[];
  cypher_shown: string;
  confidence: number;
  explanation?: string;
}

export interface MergeSuggestion {
  id: number;
  a_value: string;
  b_value: string;
  node_type: string;
  score: number;
  reason: string;
  status?: string;
}

export interface ReviewRelation {
  id: number;
  src: number;
  dst: number;
  src_value: string;
  dst_value: string;
  edge_type: string;
  confidence: number;
  snippet: string;
  engine: string;
}

export interface AlertItem {
  id: number;
  kind: string;
  severity: string;
  message: string;
  title?: string;
  case_fir?: string;
  case?: number | null;
  created_at: string;
}
