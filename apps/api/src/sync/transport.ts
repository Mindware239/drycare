/**
 * The boundary between the local queue and the cloud. Phase 3 adds an authenticated HTTPS transport
 * implementing this interface; business code never talks to the cloud directly.
 */

export interface SyncEvent {
  id: string; // stable event id — the cloud's de-duplication key
  // op "snapshot" = baseline copy taken when the PC is linked (insert or update on the cloud)
  seq: number;
  organizationId: string | null;
  branchId: string | null;
  entityTable: string;
  entityId: string;
  entityClass: "ledger" | "financial" | "operational" | "master";
  op: "insert" | "update" | "delete" | "snapshot";
  rowData: Record<string, unknown> | null;
  schemaVersion: string;
  deviceId: string;
  txid: number;
  idempotencyKey: string;
  createdAt: string;
  /** Set only when one PC change is split across uploads: its total event count, and whether this upload ends it. */
  groupSize?: number;
  groupFinal?: boolean;
}

/** What the cloud did with one event. */
export type SyncResult =
  | { id: string; outcome: "applied" }
  /** Already applied earlier (a retried batch): treated as success, nothing is created twice. */
  | { id: string; outcome: "duplicate" }
  /** Older than what the cloud already has (out of order): acknowledged, not applied. */
  | { id: string; outcome: "stale" }
  /** Part of a large change, held by the cloud (not applied) until the rest arrives. */
  | { id: string; outcome: "staged" }
  /** The cloud holds different data for this record; it was NOT overwritten. */
  | { id: string; outcome: "conflict"; reason: string; remoteData?: Record<string, unknown> | null }
  /** Temporary or permanent failure; `retryable` false stops automatic retries. */
  | { id: string; outcome: "error"; message: string; retryable: boolean };

export interface SyncTransport {
  readonly name: string;
  push(events: SyncEvent[]): Promise<SyncResult[]>;
}

/** Phase 2: no cloud yet. Processing is skipped and events stay safely pending. */
export const notConfiguredTransport: SyncTransport | null = null;
