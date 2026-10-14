import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The audit log is written by database triggers only; this just reads it (RLS: admins and audit.view). */

export interface AuditEntry {
  id: number;
  actorId: string | null;
  tableName: string;
  rowKey: string;
  action: "insert" | "update" | "delete";
  changes: Record<string, unknown>;
  createdAt: string;
}

export async function listAudit(client: SupabaseClient, limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await client
    .from("audit_log")
    .select("id, actor_id, table_name, row_key, action, changes, created_at")
    .order("id", { ascending: false })
    .limit(limit)
    .returns<{ id: number; actor_id: string | null; table_name: string; row_key: string; action: AuditEntry["action"]; changes: Record<string, unknown>; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load the audit log: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, actorId: r.actor_id, tableName: r.table_name, rowKey: r.row_key, action: r.action, changes: r.changes ?? {}, createdAt: r.created_at }));
}
