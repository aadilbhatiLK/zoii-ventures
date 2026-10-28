import { ClientInputSchema, ClientListQuerySchema, type Client, type ClientInputParsed } from "@/lib/api/contracts";
import { canViewLead } from "@/lib/permissions";
import { STATE_CODES } from "@/lib/validation/gstin";
import type { Queryable } from "../../db";
import { type Actor, audit, need, nextNumber } from "../../lib/context";
import { HttpError, conflict, notFound, parse } from "../../lib/errors";
import { iso, isUuid, likeTerm } from "../../lib/query";
import { teamOfMap } from "../users/repo";
import { toActivity, type ActivityRow } from "./leads";

export const stateCodeFor = (stateName: string): string | null => {
  const n = stateName.trim().toLowerCase();
  return Object.entries(STATE_CODES).find(([, v]) => v.toLowerCase() === n)?.[0] ?? null;
};

const CLIENT_SELECT = `
  SELECT c.*, t.gstin, t.pan, t.state_code AS tax_state_code, t.registration_type,
    (SELECT row_to_json(a) FROM client_addresses a WHERE a.client_id = c.id AND a.kind = 'billing' AND a.is_default LIMIT 1) AS billing,
    coalesce((SELECT json_agg(ct ORDER BY ct.is_primary DESC, ct.created_at) FROM client_contacts ct WHERE ct.client_id = c.id), '[]') AS contacts,
    coalesce((SELECT array_agg(p.product_line ORDER BY p.product_line) FROM client_product_lines p WHERE p.client_id = c.id), '{}') AS product_lines
  FROM clients c LEFT JOIN client_tax_profiles t ON t.client_id = c.id`;

interface ClientRow {
  id: string; code: string; display_name: string; legal_name: string; industry: string; category: Client["category"];
  status: Client["status"]; account_manager_id: string; website: string | null; source_lead_id: string | null;
  created_at: Date; updated_at: Date; gstin: string | null; pan: string | null; tax_state_code: string | null;
  billing: { line1: string; line2: string | null; city: string; state: string; pincode: string } | null;
  contacts: { id: string; name: string; designation: string | null; email: string | null; phone: string | null; is_primary: boolean; is_decision_maker: boolean }[];
  product_lines: Client["productLines"];
}

const toClient = (r: ClientRow): Client => ({
  id: r.id, code: r.code, name: r.display_name, legalName: r.legal_name, industry: r.industry, category: r.category,
  status: r.status, accountManagerId: r.account_manager_id, gstin: r.gstin, pan: r.pan,
  billingAddress: r.billing
    ? { line1: r.billing.line1, line2: r.billing.line2, city: r.billing.city, state: r.billing.state, pincode: r.billing.pincode }
    : { line1: "To be confirmed", line2: null, city: "", state: "", pincode: "" },
  website: r.website,
  contacts: r.contacts.map((c) => ({ id: c.id, name: c.name, designation: c.designation, email: c.email, phone: c.phone, isPrimary: c.is_primary, isDecisionMaker: c.is_decision_maker })),
  productLines: r.product_lines, sourceLeadId: r.source_lead_id, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});

export async function getClient(q: Queryable, a: Actor, id: string, lock = false): Promise<Client> {
  need(a, "clients.view");
  if (!isUuid(id)) throw notFound("Client");
  const r = await q.query<ClientRow>(`${CLIENT_SELECT} WHERE c.id = $1 AND c.organization_id = $2${lock ? " FOR UPDATE OF c" : ""}`, [id, a.orgId]);
  if (!r.rows[0]) throw notFound("Client");
  return toClient(r.rows[0]);
}

/** Client's place-of-supply state code: GSTIN prefix, else billing-address state. */
export async function clientStateCode(q: Queryable, orgId: string, clientId: string): Promise<string | null> {
  const r = await q.query<{ s: string | null }>(
    `SELECT coalesce(t.state_code, a.state_code) AS s FROM clients c
       LEFT JOIN client_tax_profiles t ON t.client_id = c.id
       LEFT JOIN client_addresses a ON a.client_id = c.id AND a.kind = 'billing' AND a.is_default
      WHERE c.id = $1 AND c.organization_id = $2`, [clientId, orgId]);
  return r.rows[0]?.s ?? null;
}

async function checkManager(q: Queryable, orgId: string, id: string) {
  if (!isUuid(id) || !(await q.query(`SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND status = 'active'`, [id, orgId])).rows.length)
    throw new HttpError("VALIDATION", "Choose an active account manager.", { accountManagerId: ["Unknown user"] });
}

export interface NewClient {
  name: string; legalName: string; industry: string; category: Client["category"]; status: Client["status"];
  accountManagerId: string; productLines: string[]; sourceLeadId?: string; gstin?: string; website?: string;
  billingAddress?: ClientInputParsed["billingAddress"];
  primaryContact: { name: string; designation?: string; email?: string; phone: string };
}

async function writeTaxAndAddress(q: Queryable, orgId: string, clientId: string, d: Pick<NewClient, "gstin" | "billingAddress">) {
  const stateFromAddress = d.billingAddress ? stateCodeFor(d.billingAddress.state) : null;
  const gstState = d.gstin ? d.gstin.slice(0, 2) : null;
  await q.query(
    `INSERT INTO client_tax_profiles (client_id, organization_id, registration_type, gstin, pan, state_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (client_id) DO UPDATE SET registration_type = EXCLUDED.registration_type, gstin = EXCLUDED.gstin, pan = EXCLUDED.pan, state_code = EXCLUDED.state_code`,
    [clientId, orgId, d.gstin ? "regular" : "unregistered", d.gstin ?? null, d.gstin ? d.gstin.slice(2, 12) : null, gstState ?? stateFromAddress],
  );
  if (d.billingAddress) {
    const b = d.billingAddress;
    await q.query(`DELETE FROM client_addresses WHERE client_id = $1 AND kind = 'billing'`, [clientId]);
    await q.query(
      `INSERT INTO client_addresses (organization_id, client_id, kind, line1, line2, city, state, state_code, pincode, is_default)
       VALUES ($1,$2,'billing',$3,$4,$5,$6,$7,$8,true)`,
      [orgId, clientId, b.line1, b.line2 ?? null, b.city, b.state, stateFromAddress, b.pincode],
    );
  }
}

async function gstinTaken(q: Queryable, orgId: string, gstin: string | undefined, exceptId?: string) {
  if (!gstin) return;
  const r = await q.query(`SELECT 1 FROM client_tax_profiles WHERE organization_id = $1 AND gstin = $2 AND client_id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')`, [orgId, gstin, exceptId ?? null]);
  if (r.rows.length) throw new HttpError("CONFLICT", "A client with this GSTIN already exists.", { gstin: ["Already registered to another client"] });
}

export async function createClientRecord(q: Queryable, a: Actor, d: NewClient): Promise<string> {
  await checkManager(q, a.orgId, d.accountManagerId);
  await gstinTaken(q, a.orgId, d.gstin);
  const n = await nextNumber(q, a.orgId, "client");
  const r = await q.query<{ id: string }>(
    `INSERT INTO clients (organization_id, code, display_name, legal_name, industry, category, status, account_manager_id, website, source_lead_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [a.orgId, `CL-${200 + n}`, d.name, d.legalName, d.industry, d.category, d.status, d.accountManagerId, d.website ?? null, d.sourceLeadId ?? null, a.userId],
  );
  const id = r.rows[0].id;
  await writeTaxAndAddress(q, a.orgId, id, d);
  await q.query(
    `INSERT INTO client_contacts (organization_id, client_id, name, designation, email, phone, is_primary, is_decision_maker) VALUES ($1,$2,$3,$4,$5,$6,true,true)`,
    [a.orgId, id, d.primaryContact.name, d.primaryContact.designation ?? null, d.primaryContact.email ?? null, d.primaryContact.phone],
  );
  if (d.productLines.length)
    await q.query(`INSERT INTO client_product_lines (organization_id, client_id, product_line) SELECT $1, $2, unnest($3::text[])`, [a.orgId, id, [...new Set(d.productLines)]]);
  await audit(q, a, "client.create", "client", id, { name: d.name, gstin: d.gstin ?? null, sourceLeadId: d.sourceLeadId ?? null });
  return id;
}

export class ClientService {
  constructor(private db: import("../../db").Db) {}

  async list(a: Actor, raw: unknown) {
    need(a, "clients.view");
    const q = parse(ClientListQuerySchema, raw);
    const where = ["c.organization_id = $1"];
    const params: unknown[] = [a.orgId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.search) {
      const t = p(likeTerm(q.search.toLowerCase()));
      where.push(`(lower(c.display_name) LIKE ${t} OR lower(c.legal_name) LIKE ${t} OR lower(c.code) LIKE ${t} OR lower(coalesce(t.gstin,'')) LIKE ${t}
        OR EXISTS (SELECT 1 FROM client_addresses ad WHERE ad.client_id = c.id AND lower(ad.city) LIKE ${t})
        OR EXISTS (SELECT 1 FROM client_contacts ct WHERE ct.client_id = c.id AND lower(ct.name) LIKE ${t}))`);
    }
    if (q.status?.length) where.push(`c.status = ANY(${p(q.status)})`);
    if (q.category?.length) where.push(`c.category = ANY(${p(q.category)})`);
    const w = where.join(" AND ");
    const total = Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM clients c LEFT JOIN client_tax_profiles t ON t.client_id = c.id WHERE ${w}`, params)).rows[0].n);
    const rows = await this.db.query<ClientRow>(`${CLIENT_SELECT} WHERE ${w} ORDER BY c.created_at DESC, c.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, params);
    return { items: rows.rows.map(toClient), total, page: q.page, pageSize: q.pageSize };
  }

  get(a: Actor, id: string) { return getClient(this.db, a, id); }

  async create(a: Actor, body: unknown) {
    need(a, "clients.create");
    const d = parse(ClientInputSchema, body);
    const id = await this.db.tx(async (q) => {
      const id = await createClientRecord(q, a, {
        ...d, primaryContact: { ...d.primaryContact, email: d.primaryContact.email ?? undefined, designation: d.primaryContact.designation ?? undefined },
      });
      await q.query(`INSERT INTO activities (organization_id, client_id, type, summary, actor_id) VALUES ($1,$2,'created','Client created',$3)`, [a.orgId, id, a.userId]);
      return id;
    });
    return getClient(this.db, a, id);
  }

  async update(a: Actor, id: string, body: unknown) {
    need(a, "clients.update");
    const d = parse(ClientInputSchema, body);
    await this.db.tx(async (q) => {
      const before = await getClient(q, a, id, true);
      if (d.expectedUpdatedAt && new Date(d.expectedUpdatedAt).toISOString() !== before.updatedAt)
        throw conflict("Someone else changed this record after you opened it. Reload to see their changes, then try again.");
      await gstinTaken(q, a.orgId, d.gstin, id);
      await checkManager(q, a.orgId, d.accountManagerId);
      await q.query(
        `UPDATE clients SET display_name=$2, legal_name=$3, industry=$4, category=$5, status=$6, account_manager_id=$7, website=$8 WHERE id = $1`,
        [id, d.name, d.legalName, d.industry, d.category, d.status, d.accountManagerId, d.website ?? null],
      );
      await writeTaxAndAddress(q, a.orgId, id, d);
      await q.query(
        `UPDATE client_contacts SET name=$2, designation=$3, email=$4, phone=$5 WHERE client_id = $1 AND is_primary`,
        [id, d.primaryContact.name, d.primaryContact.designation ?? null, d.primaryContact.email ?? null, d.primaryContact.phone],
      );
      await q.query(`DELETE FROM client_product_lines WHERE client_id = $1`, [id]);
      if (d.productLines.length) await q.query(`INSERT INTO client_product_lines (organization_id, client_id, product_line) SELECT $1, $2, unnest($3::text[])`, [a.orgId, id, [...new Set(d.productLines)]]);
      await q.query(`INSERT INTO activities (organization_id, client_id, type, summary, actor_id) VALUES ($1,$2,'updated','Client profile updated',$3)`, [a.orgId, id, a.userId]);
      const changes: Record<string, unknown> = {};
      if (before.gstin !== (d.gstin ?? null)) changes.gstin = { from: before.gstin, to: d.gstin ?? null };
      if (before.status !== d.status) changes.status = { from: before.status, to: d.status };
      if (before.name !== d.name) changes.name = { from: before.name, to: d.name };
      if (before.accountManagerId !== d.accountManagerId) changes.accountManagerId = { from: before.accountManagerId, to: d.accountManagerId };
      await audit(q, a, "client.update", "client", id, changes);
    });
    return getClient(this.db, a, id);
  }

  async timeline(a: Actor, id: string) {
    const client = await getClient(this.db, a, id);
    let includeLead = false;
    if (client.sourceLeadId) {
      const owner = (await this.db.query<{ owner_id: string }>(`SELECT owner_id FROM leads WHERE id = $1`, [client.sourceLeadId])).rows[0];
      const teams = await teamOfMap(this.db, a.orgId);
      includeLead = !!owner && canViewLead({ id: a.userId, roles: a.roles, teamId: a.teamId }, { ownerId: owner.owner_id }, (u) => teams.get(u) ?? null);
    }
    const r = await this.db.query<ActivityRow>(
      `SELECT * FROM activities WHERE client_id = $1 OR ($2::uuid IS NOT NULL AND lead_id = $2) ORDER BY occurred_at DESC, id`,
      [id, includeLead ? client.sourceLeadId : null],
    );
    return r.rows.map(toActivity);
  }
}
