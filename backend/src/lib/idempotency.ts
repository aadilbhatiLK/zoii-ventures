import { createHash } from "node:crypto";
import type { Queryable } from "../db";
import { conflict, invalid } from "./errors";

/**
 * Exactly-once writes for retried requests (payments, imports). Same key + same body →
 * the stored response; same key + different body → 409. Runs inside the caller's tx, so
 * the key row commits (or rolls back) together with the business change.
 */
export async function idempotent<T>(q: Queryable, orgId: string, scope: string, key: string | undefined, body: unknown, run: () => Promise<T>): Promise<T> {
  if (!key) throw invalid("Send an Idempotency-Key header so a retry can't record this twice.");
  if (key.length < 8 || key.length > 200) throw invalid("Idempotency-Key must be 8–200 characters.");
  const hash = createHash("sha256").update(JSON.stringify(body ?? null)).digest();
  const ins = await q.query(
    `INSERT INTO idempotency_keys (organization_id, key, scope, request_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key`,
    [orgId, key, scope, hash],
  );
  if (!ins.rows.length) {
    const prev = (await q.query<{ request_hash: Buffer; response_body: T | null }>(
      `SELECT request_hash, response_body FROM idempotency_keys WHERE organization_id = $1 AND scope = $2 AND key = $3 FOR UPDATE`, [orgId, scope, key])).rows[0];
    if (!Buffer.from(prev.request_hash).equals(hash)) throw conflict("This Idempotency-Key was already used for a different request.");
    if (prev.response_body !== null) return prev.response_body;
    throw conflict("The original request with this key is still being processed.");
  }
  const out = await run();
  await q.query(`UPDATE idempotency_keys SET response_status = 200, response_body = $4 WHERE organization_id = $1 AND scope = $2 AND key = $3`, [orgId, scope, key, JSON.stringify(out)]);
  return out;
}
