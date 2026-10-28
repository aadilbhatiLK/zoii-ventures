import { OPEN_STAGES, LEAD_STAGES, stageMeta, type DashboardSummary, type Notification, type SearchResult } from "@/lib/api/contracts";
import { can, leadScope } from "@/lib/permissions";
import { divRound, fromPaise, sum, toPaise } from "@/lib/money";
import { type Actor, type Deps, need, notify } from "../../lib/context";
import { iso, likeTerm } from "../../lib/query";
import { LEAD_SELECT, istDayStart, scopeSql, toLead, type LeadRow } from "./leads";

const P = (v: string | null | undefined) => toPaise(v ?? "0");

export async function dashboardSummary(deps: Deps, a: Actor): Promise<DashboardSummary> {
  need(a, "dashboard.view");
  const scope = leadScope(a);
  const sc = scopeSql(a, 2);
  const leads = scope === "none" ? [] : (await deps.db.query<LeadRow>(`${LEAD_SELECT} WHERE l.organization_id = $1 AND ${sc.sql}`, [a.orgId, ...sc.params])).rows.map(toLead);
  const t = deps.now();
  const d90 = t.getTime() - 90 * 86_400_000;
  const dayStart = istDayStart(t).getTime();
  const dayEnd = dayStart + 86_400_000;
  const ist = new Date(t.getTime() + 330 * 60_000);
  const monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000;
  const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
  const closedSince = (c: string | null, t0: number) => !!c && Date.parse(c) >= t0;
  const wonRecent = leads.filter((l) => l.stage === "won" && closedSince(l.closedAt, d90));
  const lostRecent = leads.filter((l) => l.stage === "lost" && closedSince(l.closedAt, d90));
  const wonMonth = leads.filter((l) => l.stage === "won" && closedSince(l.closedAt, monthStart));
  const val = (xs: typeof leads) => fromPaise(sum(xs.map((l) => P(l.estimatedValue))));

  const productLines = new Map<string, { count: number; value: bigint }>();
  for (const l of open) {
    const share = divRound(P(l.estimatedValue), BigInt(l.productInterest.length));
    for (const p of l.productInterest) {
      const cur = productLines.get(p) ?? { count: 0, value: 0n };
      cur.count++; cur.value += share;
      productLines.set(p, cur);
    }
  }
  const owners = new Map<string, { open: number; won: number; wonValue: bigint }>();
  for (const l of leads) {
    const cur = owners.get(l.ownerId) ?? { open: 0, won: 0, wonValue: 0n };
    if (OPEN_STAGES.includes(l.stage)) cur.open++;
    if (l.stage === "won") { cur.won++; cur.wonValue += P(l.estimatedValue); }
    owners.set(l.ownerId, cur);
  }
  const closed = wonRecent.length + lostRecent.length;

  let revenueSeries: DashboardSummary["revenueSeries"] = null;
  if (can(a, "dashboard.view_company_metrics")) {
    const r = await deps.db.query<{ month: string; invoiced: string | null; collected: string | null }>(
      `WITH months AS (
         SELECT to_char(date_trunc('month', ($2::date - (n || ' months')::interval)), 'YYYY-MM') AS month
           FROM generate_series(0, 11) n)
       SELECT m.month,
         (SELECT sum(i.taxable_total) FROM invoices i WHERE i.organization_id = $1 AND i.status NOT IN ('draft','cancelled') AND to_char(i.invoice_date, 'YYYY-MM') = m.month) AS invoiced,
         (SELECT sum(rc.amount) FROM receipts rc WHERE rc.organization_id = $1 AND to_char(rc.receipt_date, 'YYYY-MM') = m.month) AS collected
       FROM months m ORDER BY m.month`,
      [a.orgId, ist.toISOString().slice(0, 10)],
    );
    revenueSeries = {
      origin: "ledger",
      points: r.rows.map((x) => ({ month: x.month, invoiced: fromPaise(P(x.invoiced)), collected: fromPaise(P(x.collected)) })),
    };
  }

  return {
    generatedAt: t.toISOString(),
    dataOrigin: "live",
    scope: scope === "all" ? "company" : scope === "team" ? "team" : "own",
    pipeline: {
      openCount: open.length,
      openValue: val(open),
      weightedValue: fromPaise(sum(open.map((l) => divRound(P(l.estimatedValue) * BigInt(stageMeta(l.stage).probability), 100n)))),
      byStage: LEAD_STAGES.map(({ key }) => {
        const xs = leads.filter((l) => l.stage === key);
        return { stage: key, count: xs.length, value: val(xs) };
      }),
      byProductLine: [...productLines.entries()]
        .map(([productLine, v]) => ({ productLine: productLine as never, count: v.count, value: fromPaise(v.value) }))
        .sort((x, y) => Number(P(y.value) - P(x.value))),
    },
    conversion: { leadsCreated90d: leads.filter((l) => Date.parse(l.createdAt) >= d90).length, won90d: wonRecent.length, lost90d: lostRecent.length, rate: closed ? (wonRecent.length / closed) * 100 : 0 },
    wonThisMonth: { count: wonMonth.length, value: val(wonMonth) },
    followUps: {
      overdue: open.filter((l) => l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < dayStart).length,
      dueToday: open.filter((l) => l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) >= dayStart && Date.parse(l.nextFollowUpAt) < dayEnd).length,
    },
    revenueSeries,
    ownerLeaderboard: [...owners.entries()]
      .map(([ownerId, v]) => ({ ownerId, open: v.open, won: v.won, wonValue: fromPaise(v.wonValue) }))
      .sort((x, y) => Number(P(y.wonValue) - P(x.wonValue))),
  };
}

export async function search(deps: Deps, a: Actor, term: string): Promise<SearchResult[]> {
  const t = term.trim().toLowerCase().slice(0, 120);
  if (t.length < 2) return [];
  const like = likeTerm(t);
  const out: SearchResult[] = [];
  if (leadScope(a) !== "none") {
    const sc = scopeSql(a, 3);
    const r = await deps.db.query<LeadRow>(
      `${LEAD_SELECT} WHERE l.organization_id = $1 AND ${sc.sql} AND (lower(l.contact_name) LIKE $2 OR lower(coalesce(l.company,'')) LIKE $2 OR lower(l.code) LIKE $2) ORDER BY l.created_at DESC LIMIT 6`,
      [a.orgId, like, ...sc.params],
    );
    out.push(...r.rows.map((l) => ({ type: "lead" as const, id: l.id, title: l.company ?? l.contact_name, subtitle: `${l.code} · ${l.contact_name} · ${stageMeta(l.stage).label}`, href: `/leads/${l.id}` })));
  }
  if (can(a, "clients.view")) {
    const r = await deps.db.query<{ id: string; code: string; display_name: string; city: string | null }>(
      `SELECT c.id, c.code, c.display_name, (SELECT city FROM client_addresses ad WHERE ad.client_id = c.id AND ad.is_default LIMIT 1) AS city
         FROM clients c WHERE c.organization_id = $1 AND (lower(c.display_name) LIKE $2 OR lower(c.code) LIKE $2) ORDER BY c.created_at DESC LIMIT 6`,
      [a.orgId, like],
    );
    out.push(...r.rows.map((c) => ({ type: "client" as const, id: c.id, title: c.display_name, subtitle: `${c.code} · ${c.city || "—"}`, href: `/clients/${c.id}` })));
  }
  return out;
}

/** Materialises follow-up reminders for the caller (idempotent via dedupe keys). */
async function syncFollowUps(deps: Deps, a: Actor) {
  const dayStart = istDayStart(deps.now());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const r = await deps.db.query<{ id: string; contact_name: string; company: string | null; next_follow_up_at: Date }>(
    `SELECT id, contact_name, company, next_follow_up_at FROM leads
      WHERE organization_id = $1 AND owner_id = $2 AND stage = ANY($3) AND next_follow_up_at < $4`,
    [a.orgId, a.userId, OPEN_STAGES, dayEnd],
  );
  for (const l of r.rows) {
    const at = new Date(l.next_follow_up_at);
    const overdue = at < dayStart;
    const when = at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    await notify(deps.db, a.orgId, a.userId, {
      kind: overdue ? "follow_up_overdue" : "follow_up_today",
      title: `${overdue ? "Overdue follow-up" : "Follow up today"}: ${l.company ?? l.contact_name}`,
      body: `${l.contact_name} · ${overdue ? `was due ${when}` : when}`,
      href: `/leads/${l.id}`,
      dedupeKey: `fu|${overdue ? "over" : "today"}|${l.id}|${at.toISOString()}`,
    });
  }
}

export async function listNotifications(deps: Deps, a: Actor): Promise<Notification[]> {
  await syncFollowUps(deps, a);
  const r = await deps.db.query<{ id: string; kind: string; title: string; body: string; href: string; created_at: Date; read_at: Date | null; dedupe_key: string | null }>(
    `SELECT n.* FROM notifications n
      WHERE n.user_id = $1
        -- reminders for follow-ups that were since moved or completed are dropped
        AND (n.dedupe_key IS NULL OR n.dedupe_key NOT LIKE 'fu|%' OR EXISTS (
              SELECT 1 FROM leads l WHERE l.id::text = split_part(n.dedupe_key, '|', 3)
                AND l.next_follow_up_at = split_part(n.dedupe_key, '|', 4)::timestamptz AND l.stage = ANY($2)))
      ORDER BY (n.read_at IS NOT NULL), n.created_at DESC LIMIT 30`,
    [a.userId, OPEN_STAGES],
  );
  const known = ["follow_up_overdue", "follow_up_today", "assignment", "system"];
  return r.rows.map((n) => ({
    id: n.id, kind: (known.includes(n.kind) ? n.kind : "system") as Notification["kind"], title: n.title, body: n.body, href: n.href,
    createdAt: iso(n.created_at)!, read: !!n.read_at,
  }));
}

export async function markNotificationsRead(deps: Deps, a: Actor, ids: string[]) {
  await deps.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id::text = ANY($2) AND read_at IS NULL`, [a.userId, ids]);
}
