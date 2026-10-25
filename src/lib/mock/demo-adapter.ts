/**
 * Demo (development) implementation of ApiClient.
 *
 * - Runs entirely in the browser on fictional seed data (src/lib/mock/seed.ts).
 * - Enforces the SAME authorization rules the backend must enforce (permission +
 *   record-level checks), so the UI is exercised against realistic denials.
 * - Every write appends an audit event, mirroring the backend contract.
 * - Can only be constructed when appConfig.mode === "demo" (see lib/api/index.ts).
 */
import type { ApiClient } from "@/lib/api/client";
import {
  ClientInputSchema,
  ConvertLeadInputSchema,
  LeadInputSchema,
  LeadListQuerySchema,
  LeadStageSchema,
  ClientListQuerySchema,
  LogActivityInputSchema,
  OPEN_STAGES,
  stageMeta,
  type Activity,
  type Client,
  type DashboardSummary,
  type Lead,
  type LeadStage,
  type Notification,
  type User,
} from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import { can, canEditLead, canViewLead, leadScope, type Permission } from "@/lib/permissions";
import { buildDemoSeed, demoRevenueFixture, type DemoSeed } from "./seed";

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: "lead" | "client";
  entityId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface DemoState extends DemoSeed {
  audit: AuditEvent[];
  readNotifications: Record<string, string[]>;
  seq: { lead: number; client: number; activity: number; audit: number };
}

const STORAGE_KEY = "zoii.demo.store.v2";

function freshState(now: Date): DemoState {
  const seed = buildDemoSeed(now);
  return {
    ...seed,
    audit: [],
    readNotifications: {},
    seq: {
      lead: seed.leads.length,
      client: seed.clients.length,
      activity: seed.activities.length,
      audit: 0,
    },
  };
}

function loadState(persist: boolean, now: Date): DemoState {
  if (persist && typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as DemoState;
    } catch {
      /* storage unavailable: fall through to a fresh seed */
    }
  }
  return freshState(now);
}

export interface DemoClientOptions {
  /** Returns the signed-in user, or null. Authorization is evaluated per call. */
  getUser: () => User | null;
  latencyMs?: number;
  /** Persist demo edits for the browser tab (sessionStorage). Off in tests. */
  persist?: boolean;
  now?: () => Date;
}

export function createDemoApiClient(
  opts: DemoClientOptions,
): ApiClient & { __audit(): AuditEvent[]; __reset(): void } {
  const now = opts.now ?? (() => new Date());
  const persist = opts.persist ?? true;
  let state = loadState(persist, now());
  const latency = opts.latencyMs ?? 280;

  const save = () => {
    if (!persist || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or privacy mode — demo continues in memory */
    }
  };
  const delay = () =>
    latency > 0
      ? new Promise((r) => setTimeout(r, latency * (0.7 + Math.random() * 0.6)))
      : Promise.resolve();
  const clone = <T>(v: T): T => structuredClone(v);
  const isoNow = () => now().toISOString();

  // ---------- auth helpers ----------
  const requireUser = (): User => {
    const user = opts.getUser();
    if (!user)
      throw new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue." }, 401);
    return user;
  };
  const requirePerm = (user: User, perm: Permission) => {
    if (!can(user, perm))
      throw new ApiError(
        { code: "FORBIDDEN", message: "You don't have permission to do that." },
        403,
      );
  };
  const teamOf = (userId: string) => state.users.find((u) => u.id === userId)?.teamId ?? null;
  const visibleLeads = (user: User) => state.leads.filter((l) => canViewLead(user, l, teamOf));
  const findVisibleLead = (user: User, id: string): Lead => {
    const lead = state.leads.find((l) => l.id === id);
    // Invisible and missing records are indistinguishable to the caller.
    if (!lead || !canViewLead(user, lead, teamOf))
      throw new ApiError({ code: "NOT_FOUND", message: "Lead not found." }, 404);
    return lead;
  };
  const findEditableLead = (user: User, id: string): Lead => {
    const lead = findVisibleLead(user, id);
    if (!canEditLead(user, lead, teamOf))
      throw new ApiError(
        { code: "FORBIDDEN", message: "You can view this lead but not change it." },
        403,
      );
    return lead;
  };
  const assignableUsers = (user: User): User[] => {
    const sellers = state.users.filter((u) =>
      u.roles.some((r) => r === "sales_executive" || r === "sales_manager" || r === "founder"),
    );
    if (!can(user, "leads.assign")) return state.users.filter((u) => u.id === user.id);
    if (leadScope(user) === "all") return sellers;
    return sellers.filter(
      (u) => u.id === user.id || (user.teamId !== null && u.teamId === user.teamId),
    );
  };

  // ---------- write helpers ----------
  const addActivity = (
    a: Omit<Activity, "id" | "occurredAt"> & { occurredAt?: string },
  ): Activity => {
    const act: Activity = {
      ...a,
      id: `act_${++state.seq.activity}`,
      occurredAt: a.occurredAt ?? isoNow(),
    };
    state.activities.push(act);
    return act;
  };
  const audit = (
    actorId: string,
    action: string,
    entityType: AuditEvent["entityType"],
    entityId: string,
    before: object | null,
    after: object,
  ) => {
    const changes: AuditEvent["changes"] = {};
    for (const [k, v] of Object.entries(after)) {
      const prev = before ? (before as Record<string, unknown>)[k] : undefined;
      if (JSON.stringify(prev) !== JSON.stringify(v)) changes[k] = { from: prev ?? null, to: v };
    }
    state.audit.push({
      id: `aud_${++state.seq.audit}`,
      at: isoNow(),
      actorId,
      action,
      entityType,
      entityId,
      changes,
    });
  };
  const scoreFor = (l: Pick<Lead, "priority" | "estimatedValue" | "source">) => {
    const base = l.priority === "high" ? 60 : l.priority === "medium" ? 40 : 22;
    const v = Number(l.estimatedValue);
    const valueBonus = v >= 5_00_000 ? 20 : v >= 1_50_000 ? 12 : v >= 50_000 ? 6 : 0;
    const sourceBonus =
      l.source === "referral" || l.source === "partner"
        ? 14
        : l.source === "website" || l.source === "whatsapp"
          ? 7
          : 0;
    return Math.min(99, base + valueBonus + sourceBonus);
  };
  const assertFresh = (current: string, expected: string | undefined) => {
    if (expected && expected !== current) {
      throw new ApiError(
        {
          code: "CONFLICT",
          message:
            "Someone else changed this record after you opened it. Reload to see their changes, then try again.",
        },
        409,
      );
    }
  };
  const closedStage = (stage: LeadStage) => stage === "won" || stage === "lost";
  const parseWhen = (value: string, field: string): string => {
    const t = Date.parse(value);
    if (Number.isNaN(t))
      throw new ApiError(
        {
          code: "VALIDATION",
          message: "Pick a valid date.",
          details: { [field]: ["Invalid date"] },
        },
        422,
      );
    return new Date(t).toISOString();
  };
  const normPhone = (p: string) => p.replace(/\D/g, "").slice(-10);
  const normCompany = (c: string) =>
    c
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/(pvtltd|privatelimited|llp|ltd)$/, "");

  const sum = (xs: Lead[]) => xs.reduce((s, l) => s + Number(l.estimatedValue), 0);
  const money = (n: number) => `${Math.round(n)}.00`;

  /** Scoped, filtered and sorted leads for a list query — shared by list and export. */
  const queryLeads = (user: User, rawQuery: unknown) => {
    if (leadScope(user) === "none")
      throw new ApiError({ code: "FORBIDDEN", message: "You don't have access to leads." }, 403);
    const parsedQ = LeadListQuerySchema.safeParse(rawQuery);
    if (!parsedQ.success) throw ApiError.fromZod(parsedQ.error);
    const q = parsedQ.data;
    const today = now();
    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    let rows = visibleLeads(user);

    switch (q.view) {
      case "mine":
        rows = rows.filter((l) => l.ownerId === user.id);
        break;
      case "open":
        rows = rows.filter((l) => OPEN_STAGES.includes(l.stage));
        break;
      case "due_today":
        rows = rows.filter(
          (l) =>
            l.nextFollowUpAt &&
            new Date(l.nextFollowUpAt) >= dayStart &&
            new Date(l.nextFollowUpAt) < dayEnd,
        );
        break;
      case "overdue":
        rows = rows.filter(
          (l) =>
            l.nextFollowUpAt &&
            new Date(l.nextFollowUpAt) < dayStart &&
            OPEN_STAGES.includes(l.stage),
        );
        break;
      case "hot":
        rows = rows.filter(
          (l) => OPEN_STAGES.includes(l.stage) && (l.priority === "high" || l.score >= 70),
        );
        break;
    }
    if (q.search) {
      const term = q.search.toLowerCase();
      const digits = term.replace(/\D/g, "");
      rows = rows.filter(
        (l) =>
          l.name.toLowerCase().includes(term) ||
          (l.company ?? "").toLowerCase().includes(term) ||
          (l.email ?? "").includes(term) ||
          l.code.toLowerCase().includes(term) ||
          (l.city ?? "").toLowerCase().includes(term) ||
          (digits.length >= 4 && l.phone.replace(/\D/g, "").includes(digits)),
      );
    }
    if (q.stage?.length) rows = rows.filter((l) => q.stage!.includes(l.stage));
    if (q.productLine?.length)
      rows = rows.filter((l) => l.productInterest.some((p) => q.productLine!.includes(p)));
    if (q.ownerId?.length) rows = rows.filter((l) => q.ownerId!.includes(l.ownerId));
    if (q.source?.length) rows = rows.filter((l) => q.source!.includes(l.source));
    if (q.priority?.length) rows = rows.filter((l) => q.priority!.includes(l.priority));

    const sort = q.sort ?? { field: "createdAt", dir: "desc" as const };
    const dir = sort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      if (av === bv) return 0;
      if (av === null) return 1; // nulls last regardless of direction
      if (bv === null) return -1;
      if (sort.field === "estimatedValue") return (Number(av) - Number(bv)) * dir;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    return { rows, q };
  };

  const api: ApiClient & { __audit(): AuditEvent[]; __reset(): void } = {
    mode: "demo",

    __audit: () => clone(state.audit),
    __reset: () => {
      state = freshState(now());
      save();
    },

    leads: {
      async list(rawQuery) {
        await delay();
        const { rows, q } = queryLeads(requireUser(), rawQuery);
        const start = (q.page - 1) * q.pageSize;
        return {
          items: clone(rows.slice(start, start + q.pageSize)),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
          totalValue: money(sum(rows)),
        };
      },

      async export(rawQuery) {
        await delay();
        const user = requireUser();
        requirePerm(user, "leads.export");
        const { rows } = queryLeads(user, { ...(rawQuery as object), page: 1, pageSize: 50 });
        const LIMIT = 5000;
        state.audit.push({
          id: `aud_${++state.seq.audit}`,
          at: isoNow(),
          actorId: user.id,
          action: "lead.export",
          entityType: "lead",
          entityId: "*",
          changes: { rows: { from: null, to: Math.min(rows.length, LIMIT) } },
        });
        save();
        return {
          rows: clone(rows.slice(0, LIMIT)),
          total: rows.length,
          truncated: rows.length > LIMIT,
        };
      },

      async get(id) {
        await delay();
        return clone(findVisibleLead(requireUser(), id));
      },

      async create(input) {
        await delay();
        const user = requireUser();
        requirePerm(user, "leads.create");
        const parsed = LeadInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const data = parsed.data;
        if (data.ownerId !== user.id && !assignableUsers(user).some((u) => u.id === data.ownerId)) {
          throw new ApiError(
            { code: "FORBIDDEN", message: "You can't assign leads to that person." },
            403,
          );
        }
        const ts = isoNow();
        const n = ++state.seq.lead;
        const lead: Lead = {
          id: `lead_${String(n).padStart(3, "0")}_${Math.random().toString(36).slice(2, 6)}`,
          code: `LD-${1000 + n}`,
          name: data.name,
          company: data.company ?? null,
          email: data.email ?? null,
          phone: data.phone,
          city: data.city ?? null,
          productInterest: data.productInterest,
          source: data.source,
          campaign: data.campaign ?? null,
          stage: "new",
          priority: data.priority,
          score: scoreFor(data),
          estimatedValue: data.estimatedValue,
          ownerId: data.ownerId,
          nextFollowUpAt: data.nextFollowUpAt ?? null,
          closedAt: null,
          lostReason: null,
          clientId: null,
          notes: data.notes ?? null,
          createdAt: ts,
          updatedAt: ts,
          createdById: user.id,
        };
        state.leads.push(lead);
        addActivity({
          entityType: "lead",
          entityId: lead.id,
          type: "created",
          summary: "Lead created",
          body: null,
          actorId: user.id,
          meta: {},
        });
        if (lead.ownerId !== user.id) {
          addActivity({
            entityType: "lead",
            entityId: lead.id,
            type: "assignment",
            summary: `Assigned to ${state.users.find((u) => u.id === lead.ownerId)?.name ?? "owner"}`,
            body: null,
            actorId: user.id,
            meta: { to: lead.ownerId },
          });
        }
        audit(user.id, "lead.create", "lead", lead.id, null, lead);
        save();
        return clone(lead);
      },

      async update(id, input) {
        await delay();
        const user = requireUser();
        const lead = findEditableLead(user, id);
        const parsed = LeadInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const data = parsed.data;
        assertFresh(lead.updatedAt, data.expectedUpdatedAt);
        if (closedStage(lead.stage) && data.nextFollowUpAt) {
          throw new ApiError(
            { code: "CONFLICT", message: "Closed leads don't take follow-ups." },
            409,
          );
        }
        if (data.ownerId !== lead.ownerId) {
          requirePerm(user, "leads.assign");
          if (!assignableUsers(user).some((u) => u.id === data.ownerId)) {
            throw new ApiError(
              { code: "FORBIDDEN", message: "You can't assign leads to that person." },
              403,
            );
          }
        }
        const before = clone(lead);
        Object.assign(lead, {
          name: data.name,
          company: data.company ?? null,
          email: data.email ?? null,
          phone: data.phone,
          city: data.city ?? null,
          productInterest: data.productInterest,
          source: data.source,
          campaign: data.campaign ?? null,
          priority: data.priority,
          estimatedValue: data.estimatedValue,
          ownerId: data.ownerId,
          nextFollowUpAt: data.nextFollowUpAt ?? null,
          notes: data.notes ?? null,
          score: scoreFor(data),
          updatedAt: isoNow(),
        });
        if (before.ownerId !== lead.ownerId) {
          addActivity({
            entityType: "lead",
            entityId: id,
            type: "assignment",
            summary: `Reassigned to ${state.users.find((u) => u.id === lead.ownerId)?.name ?? "owner"}`,
            body: null,
            actorId: user.id,
            meta: { from: before.ownerId, to: lead.ownerId },
          });
        }
        addActivity({
          entityType: "lead",
          entityId: id,
          type: "updated",
          summary: "Lead details updated",
          body: null,
          actorId: user.id,
          meta: {},
        });
        audit(user.id, "lead.update", "lead", id, before, lead);
        save();
        return clone(lead);
      },

      async assign(ids, ownerId) {
        await delay();
        const user = requireUser();
        requirePerm(user, "leads.assign");
        const target = assignableUsers(user).find((u) => u.id === ownerId);
        if (!target)
          throw new ApiError(
            { code: "FORBIDDEN", message: "You can't assign leads to that person." },
            403,
          );
        // All-or-nothing: validate every id before mutating anything.
        const leads = ids.map((id) => findEditableLead(user, id));
        let updated = 0;
        for (const lead of leads) {
          if (lead.ownerId === ownerId) continue;
          const before = clone(lead);
          lead.ownerId = ownerId;
          lead.updatedAt = isoNow();
          addActivity({
            entityType: "lead",
            entityId: lead.id,
            type: "assignment",
            summary: `Assigned to ${target.name}`,
            body: null,
            actorId: user.id,
            meta: { from: before.ownerId, to: ownerId },
          });
          audit(user.id, "lead.assign", "lead", lead.id, before, lead);
          updated++;
        }
        save();
        return { updated };
      },

      async changeStage(id, rawStage, extra) {
        await delay();
        const user = requireUser();
        const lead = findEditableLead(user, id);
        const stageParsed = LeadStageSchema.safeParse(rawStage);
        if (!stageParsed.success) throw ApiError.fromZod(stageParsed.error);
        const stage = stageParsed.data;
        if (stage === "won" && !lead.clientId) {
          throw new ApiError(
            {
              code: "CONFLICT",
              message:
                "Use “Convert to client” to mark a lead as won, so the client record is created with it.",
            },
            409,
          );
        }
        if (stage === "lost" && !extra?.lostReason?.trim()) {
          throw new ApiError(
            {
              code: "VALIDATION",
              message: "A lost reason is required.",
              details: { lostReason: ["Pick a reason"] },
            },
            422,
          );
        }
        if (lead.clientId && stage !== "won") {
          throw new ApiError(
            { code: "CONFLICT", message: "This lead is already converted to a client." },
            409,
          );
        }
        const before = clone(lead);
        lead.stage = stage;
        lead.lostReason = stage === "lost" ? extra!.lostReason!.trim() : null;
        if (closedStage(stage)) lead.nextFollowUpAt = null;
        lead.closedAt = closedStage(stage)
          ? before.closedAt && closedStage(before.stage)
            ? before.closedAt
            : isoNow()
          : null;
        lead.updatedAt = isoNow();
        addActivity({
          entityType: "lead",
          entityId: id,
          type: "stage_change",
          summary: `Stage moved from ${stageMeta(before.stage).label} to ${stageMeta(stage).label}`,
          body: stage === "lost" ? `Reason: ${lead.lostReason}` : null,
          actorId: user.id,
          meta: { from: before.stage, to: stage },
        });
        audit(user.id, "lead.stage", "lead", id, before, lead);
        save();
        return clone(lead);
      },

      async bulkChangeStage(ids, rawStage) {
        await delay();
        const user = requireUser();
        const stageParsed = LeadStageSchema.safeParse(rawStage);
        if (!stageParsed.success) throw ApiError.fromZod(stageParsed.error);
        const stage = stageParsed.data;
        if (closedStage(stage)) {
          throw new ApiError(
            {
              code: "VALIDATION",
              message:
                "Won needs a conversion and Lost needs a reason, so move those one lead at a time.",
            },
            422,
          );
        }
        // Validate every lead first; apply only if all pass.
        const leads = ids.map((id) => findEditableLead(user, id));
        const converted = leads.filter((l) => l.clientId);
        if (converted.length) {
          throw new ApiError(
            {
              code: "CONFLICT",
              message: `${converted.map((l) => l.code).join(", ")} ${converted.length > 1 ? "are" : "is"} already converted. Deselect and retry.`,
            },
            409,
          );
        }
        let updated = 0;
        for (const lead of leads) {
          if (lead.stage === stage) continue;
          const before = clone(lead);
          lead.stage = stage;
          lead.lostReason = null;
          lead.closedAt = null;
          lead.updatedAt = isoNow();
          addActivity({
            entityType: "lead",
            entityId: lead.id,
            type: "stage_change",
            summary: `Stage moved from ${stageMeta(before.stage).label} to ${stageMeta(stage).label}`,
            body: null,
            actorId: user.id,
            meta: { from: before.stage, to: stage },
          });
          audit(user.id, "lead.stage", "lead", lead.id, before, lead);
          updated++;
        }
        save();
        return { updated };
      },

      async findDuplicates(input, excludeId) {
        await delay();
        const user = requireUser();
        if (!can(user, "leads.create") && !can(user, "leads.update")) {
          throw new ApiError(
            { code: "FORBIDDEN", message: "You don't have permission to do that." },
            403,
          );
        }
        const phone = input.phone ? normPhone(input.phone) : "";
        const email = input.email ? input.email.trim().toLowerCase() : "";
        const company = input.company ? normCompany(input.company) : "";
        const matches: { lead: Lead; matchedOn: ("phone" | "email" | "company")[] }[] = [];
        for (const l of state.leads) {
          if (l.id === excludeId) continue;
          const on: ("phone" | "email" | "company")[] = [];
          if (phone.length === 10 && normPhone(l.phone) === phone) on.push("phone");
          if (email && l.email === email) on.push("email");
          if (company.length >= 4 && l.company && normCompany(l.company) === company)
            on.push("company");
          if (on.length) matches.push({ lead: l, matchedOn: on });
        }
        const visible = matches.filter((m) => canViewLead(user, m.lead, teamOf));
        return {
          matches: visible.map((m) => ({
            lead: {
              id: m.lead.id,
              code: m.lead.code,
              name: m.lead.name,
              company: m.lead.company,
              phone: m.lead.phone,
              email: m.lead.email,
              stage: m.lead.stage,
            },
            matchedOn: m.matchedOn,
          })),
          hiddenMatchCount: matches.length - visible.length,
        };
      },

      async activities(id) {
        await delay();
        const user = requireUser();
        findVisibleLead(user, id);
        return clone(
          state.activities
            .filter((a) => a.entityType === "lead" && a.entityId === id)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        );
      },

      async logActivity(id, input) {
        await delay();
        const user = requireUser();
        findEditableLead(user, id);
        const parsed = LogActivityInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const act = addActivity({
          entityType: "lead",
          entityId: id,
          type: parsed.data.type,
          summary: parsed.data.summary,
          body: parsed.data.body ?? null,
          actorId: user.id,
          occurredAt: parsed.data.occurredAt,
          meta: {},
        });
        save();
        return clone(act);
      },

      async scheduleFollowUp(id, at, note) {
        await delay();
        const user = requireUser();
        const lead = findEditableLead(user, id);
        if (!OPEN_STAGES.includes(lead.stage))
          throw new ApiError(
            { code: "CONFLICT", message: "Closed leads don't take follow-ups." },
            409,
          );
        const when = parseWhen(at, "at");
        const before = clone(lead);
        lead.nextFollowUpAt = when;
        lead.updatedAt = isoNow();
        addActivity({
          entityType: "lead",
          entityId: id,
          type: "follow_up_scheduled",
          summary: "Follow-up scheduled",
          body: note?.trim() || null,
          actorId: user.id,
          meta: { at: lead.nextFollowUpAt },
        });
        audit(user.id, "lead.follow_up", "lead", id, before, lead);
        save();
        return clone(lead);
      },

      async completeFollowUp(id, outcome, nextAt) {
        await delay();
        const user = requireUser();
        const lead = findEditableLead(user, id);
        if (!outcome.trim())
          throw new ApiError(
            {
              code: "VALIDATION",
              message: "Record the outcome.",
              details: { outcome: ["Required"] },
            },
            422,
          );
        if (nextAt && !OPEN_STAGES.includes(lead.stage)) {
          throw new ApiError(
            { code: "CONFLICT", message: "Closed leads don't take follow-ups." },
            409,
          );
        }
        const next = nextAt ? parseWhen(nextAt, "nextAt") : null;
        const before = clone(lead);
        lead.nextFollowUpAt = next;
        lead.updatedAt = isoNow();
        addActivity({
          entityType: "lead",
          entityId: id,
          type: "follow_up_completed",
          summary: "Follow-up completed",
          body: outcome.trim(),
          actorId: user.id,
          meta: nextAt ? { next: lead.nextFollowUpAt! } : {},
        });
        audit(user.id, "lead.follow_up_complete", "lead", id, before, lead);
        save();
        return clone(lead);
      },

      async convert(id, input) {
        await delay();
        const user = requireUser();
        requirePerm(user, "leads.convert");
        requirePerm(user, "clients.create");
        const lead = findEditableLead(user, id);
        if (lead.clientId)
          throw new ApiError({ code: "CONFLICT", message: "This lead is already converted." }, 409);
        if (lead.stage === "lost")
          throw new ApiError(
            { code: "CONFLICT", message: "Reopen a lost lead before converting it." },
            409,
          );
        const parsed = ConvertLeadInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const ts = isoNow();
        const n = ++state.seq.client;
        const client: Client = {
          id: `client_${String(n).padStart(3, "0")}_${Math.random().toString(36).slice(2, 6)}`,
          code: `CL-${200 + n}`,
          name: parsed.data.clientName,
          legalName: parsed.data.legalName,
          industry: parsed.data.industry,
          category: parsed.data.category,
          status: "onboarding",
          accountManagerId: parsed.data.accountManagerId,
          gstin: null,
          pan: null,
          billingAddress: {
            line1: "To be confirmed",
            line2: null,
            city: lead.city ?? "",
            state: "",
            pincode: "",
          },
          website: null,
          contacts: [
            {
              id: `c_${n}_1`,
              name: lead.name,
              designation: null,
              email: lead.email,
              phone: lead.phone,
              isPrimary: true,
              isDecisionMaker: true,
            },
          ],
          productLines: lead.productInterest,
          sourceLeadId: lead.id,
          createdAt: ts,
          updatedAt: ts,
        };
        // One logical transaction: client + lead update + activities + audit.
        state.clients.push(client);
        const before = clone(lead);
        lead.stage = "won";
        lead.clientId = client.id;
        lead.nextFollowUpAt = null;
        lead.closedAt = ts;
        lead.updatedAt = ts;
        addActivity({
          entityType: "lead",
          entityId: lead.id,
          type: "converted",
          summary: `Converted to client ${client.code}`,
          body: null,
          actorId: user.id,
          meta: { clientId: client.id },
        });
        addActivity({
          entityType: "client",
          entityId: client.id,
          type: "converted",
          summary: `Created from lead ${lead.code}`,
          body: null,
          actorId: user.id,
          meta: { leadId: lead.id },
        });
        audit(user.id, "lead.convert", "lead", lead.id, before, lead);
        audit(user.id, "client.create", "client", client.id, null, client);
        save();
        return { lead: clone(lead), client: clone(client) };
      },
    },

    clients: {
      async list(rawQuery) {
        await delay();
        const user = requireUser();
        requirePerm(user, "clients.view");
        const parsedQ = ClientListQuerySchema.safeParse(rawQuery);
        if (!parsedQ.success) throw ApiError.fromZod(parsedQ.error);
        const q = parsedQ.data;
        let rows = [...state.clients];
        if (q.search) {
          const t = q.search.toLowerCase();
          rows = rows.filter(
            (c) =>
              c.name.toLowerCase().includes(t) ||
              c.legalName.toLowerCase().includes(t) ||
              c.code.toLowerCase().includes(t) ||
              c.billingAddress.city.toLowerCase().includes(t) ||
              (c.gstin ?? "").toLowerCase().includes(t) ||
              c.contacts.some((ct) => ct.name.toLowerCase().includes(t)),
          );
        }
        if (q.status?.length) rows = rows.filter((c) => q.status!.includes(c.status));
        if (q.category?.length) rows = rows.filter((c) => q.category!.includes(c.category));
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const start = (q.page - 1) * q.pageSize;
        return {
          items: clone(rows.slice(start, start + q.pageSize)),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      },

      async get(id) {
        await delay();
        const user = requireUser();
        requirePerm(user, "clients.view");
        const c = state.clients.find((x) => x.id === id);
        if (!c) throw new ApiError({ code: "NOT_FOUND", message: "Client not found." }, 404);
        return clone(c);
      },

      async create(input) {
        await delay();
        const user = requireUser();
        requirePerm(user, "clients.create");
        const parsed = ClientInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const d = parsed.data;
        if (d.gstin && state.clients.some((c) => c.gstin === d.gstin)) {
          throw new ApiError(
            {
              code: "CONFLICT",
              message: "A client with this GSTIN already exists.",
              details: { gstin: ["Already registered to another client"] },
            },
            409,
          );
        }
        const ts = isoNow();
        const n = ++state.seq.client;
        const client: Client = {
          id: `client_${String(n).padStart(3, "0")}_${Math.random().toString(36).slice(2, 6)}`,
          code: `CL-${200 + n}`,
          name: d.name,
          legalName: d.legalName,
          industry: d.industry,
          category: d.category,
          status: d.status,
          accountManagerId: d.accountManagerId,
          gstin: d.gstin ?? null,
          pan: d.gstin ? d.gstin.slice(2, 12) : null,
          billingAddress: { ...d.billingAddress, line2: d.billingAddress.line2 ?? null },
          website: d.website ?? null,
          contacts: [
            {
              id: `c_${n}_1`,
              name: d.primaryContact.name,
              designation: d.primaryContact.designation ?? null,
              email: d.primaryContact.email ?? null,
              phone: d.primaryContact.phone,
              isPrimary: true,
              isDecisionMaker: true,
            },
          ],
          productLines: d.productLines,
          sourceLeadId: null,
          createdAt: ts,
          updatedAt: ts,
        };
        state.clients.push(client);
        addActivity({
          entityType: "client",
          entityId: client.id,
          type: "created",
          summary: "Client created",
          body: null,
          actorId: user.id,
          meta: {},
        });
        audit(user.id, "client.create", "client", client.id, null, client);
        save();
        return clone(client);
      },

      async update(id, input) {
        await delay();
        const user = requireUser();
        requirePerm(user, "clients.update");
        const client = state.clients.find((c) => c.id === id);
        if (!client) throw new ApiError({ code: "NOT_FOUND", message: "Client not found." }, 404);
        const parsed = ClientInputSchema.safeParse(input);
        if (!parsed.success) throw ApiError.fromZod(parsed.error);
        const d = parsed.data;
        assertFresh(client.updatedAt, d.expectedUpdatedAt);
        if (d.gstin && state.clients.some((c) => c.id !== id && c.gstin === d.gstin)) {
          throw new ApiError(
            {
              code: "CONFLICT",
              message: "A client with this GSTIN already exists.",
              details: { gstin: ["Already registered to another client"] },
            },
            409,
          );
        }
        const before = clone(client);
        const primary = client.contacts.find((c) => c.isPrimary);
        Object.assign(client, {
          name: d.name,
          legalName: d.legalName,
          industry: d.industry,
          category: d.category,
          status: d.status,
          accountManagerId: d.accountManagerId,
          gstin: d.gstin ?? null,
          pan: d.gstin ? d.gstin.slice(2, 12) : null,
          billingAddress: { ...d.billingAddress, line2: d.billingAddress.line2 ?? null },
          website: d.website ?? null,
          productLines: d.productLines,
          updatedAt: isoNow(),
        });
        if (primary) {
          Object.assign(primary, {
            name: d.primaryContact.name,
            designation: d.primaryContact.designation ?? null,
            email: d.primaryContact.email ?? null,
            phone: d.primaryContact.phone,
          });
        }
        addActivity({
          entityType: "client",
          entityId: id,
          type: "updated",
          summary: "Client profile updated",
          body: null,
          actorId: user.id,
          meta: {},
        });
        audit(user.id, "client.update", "client", id, before, client);
        save();
        return clone(client);
      },

      async timeline(id) {
        await delay();
        const user = requireUser();
        requirePerm(user, "clients.view");
        const client = state.clients.find((c) => c.id === id);
        if (!client) throw new ApiError({ code: "NOT_FOUND", message: "Client not found." }, 404);
        const sourceLead = client.sourceLeadId
          ? state.leads.find((l) => l.id === client.sourceLeadId)
          : undefined;
        const includeLead = sourceLead ? canViewLead(user, sourceLead, teamOf) : false;
        return clone(
          state.activities
            .filter(
              (a) =>
                (a.entityType === "client" && a.entityId === id) ||
                (includeLead && a.entityType === "lead" && a.entityId === sourceLead!.id),
            )
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        );
      },
    },

    users: {
      async assignable() {
        await delay();
        return clone(assignableUsers(requireUser()));
      },
      async directory() {
        await delay();
        requireUser();
        // Public profile only: no email, phone or MFA status for other users.
        return state.users.map((u) => ({
          id: u.id,
          name: u.name,
          title: u.title,
          roles: [...u.roles],
          teamId: u.teamId,
          avatarHue: u.avatarHue,
        }));
      },
    },

    dashboard: {
      async summary(): Promise<DashboardSummary> {
        await delay();
        const user = requireUser();
        requirePerm(user, "dashboard.view");
        const scope = leadScope(user);
        const leads = scope === "none" ? [] : visibleLeads(user);
        const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
        const t = now();
        const d90 = t.getTime() - 90 * 86_400_000;
        const monthStart = new Date(t.getFullYear(), t.getMonth(), 1).getTime();
        const dayStart = new Date(t);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = dayStart.getTime() + 86_400_000;
        const recent = leads.filter((l) => Date.parse(l.createdAt) >= d90);
        const closedSince = (l: Lead, t0: number) => !!l.closedAt && Date.parse(l.closedAt) >= t0;
        const wonRecent = leads.filter((l) => l.stage === "won" && closedSince(l, d90));
        const lostRecent = leads.filter((l) => l.stage === "lost" && closedSince(l, d90));
        const wonMonth = leads.filter((l) => l.stage === "won" && closedSince(l, monthStart));
        const productLines = new Map<string, { count: number; value: number }>();
        for (const l of open) {
          const share = Number(l.estimatedValue) / l.productInterest.length;
          for (const p of l.productInterest) {
            const cur = productLines.get(p) ?? { count: 0, value: 0 };
            cur.count++;
            cur.value += share;
            productLines.set(p, cur);
          }
        }
        const owners = new Map<string, { open: number; won: number; wonValue: number }>();
        for (const l of leads) {
          const cur = owners.get(l.ownerId) ?? { open: 0, won: 0, wonValue: 0 };
          if (OPEN_STAGES.includes(l.stage)) cur.open++;
          if (l.stage === "won") {
            cur.won++;
            cur.wonValue += Number(l.estimatedValue);
          }
          owners.set(l.ownerId, cur);
        }
        const closed = wonRecent.length + lostRecent.length;
        return {
          generatedAt: isoNow(),
          dataOrigin: "demo",
          scope: scope === "all" ? "company" : scope === "team" ? "team" : "own",
          pipeline: {
            openCount: open.length,
            openValue: money(sum(open)),
            weightedValue: money(
              open.reduce(
                (s, l) => s + (Number(l.estimatedValue) * stageMeta(l.stage).probability) / 100,
                0,
              ),
            ),
            byStage: (
              [
                "new",
                "contacted",
                "qualified",
                "discovery",
                "proposal",
                "negotiation",
                "won",
                "lost",
              ] as LeadStage[]
            ).map((stage) => {
              const xs = leads.filter((l) => l.stage === stage);
              return { stage, count: xs.length, value: money(sum(xs)) };
            }),
            byProductLine: [...productLines.entries()]
              .map(([productLine, v]) => ({
                productLine: productLine as Lead["productInterest"][number],
                count: v.count,
                value: money(v.value),
              }))
              .sort((a, b) => Number(b.value) - Number(a.value)),
          },
          conversion: {
            leadsCreated90d: recent.length,
            won90d: wonRecent.length,
            lost90d: lostRecent.length,
            rate: closed ? (wonRecent.length / closed) * 100 : 0,
          },
          wonThisMonth: { count: wonMonth.length, value: money(sum(wonMonth)) },
          followUps: {
            overdue: open.filter(
              (l) => l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < dayStart.getTime(),
            ).length,
            dueToday: open.filter(
              (l) =>
                l.nextFollowUpAt &&
                Date.parse(l.nextFollowUpAt) >= dayStart.getTime() &&
                Date.parse(l.nextFollowUpAt) < dayEnd,
            ).length,
          },
          revenueSeries: can(user, "dashboard.view_company_metrics")
            ? { origin: "fixture", points: demoRevenueFixture(t) }
            : null,
          ownerLeaderboard: [...owners.entries()]
            .map(([ownerId, v]) => ({
              ownerId,
              open: v.open,
              won: v.won,
              wonValue: money(v.wonValue),
            }))
            .sort((a, b) => Number(b.wonValue) - Number(a.wonValue)),
        };
      },
    },

    search: {
      async query(term) {
        await delay();
        const user = requireUser();
        const t = term.trim().toLowerCase();
        if (t.length < 2) return [];
        const leadHits =
          leadScope(user) === "none"
            ? []
            : visibleLeads(user)
                .filter(
                  (l) =>
                    l.name.toLowerCase().includes(t) ||
                    (l.company ?? "").toLowerCase().includes(t) ||
                    l.code.toLowerCase().includes(t),
                )
                .slice(0, 6)
                .map((l) => ({
                  type: "lead" as const,
                  id: l.id,
                  title: l.company ?? l.name,
                  subtitle: `${l.code} · ${l.name} · ${stageMeta(l.stage).label}`,
                  href: `/leads/${l.id}`,
                }));
        const clientHits = can(user, "clients.view")
          ? state.clients
              .filter((c) => c.name.toLowerCase().includes(t) || c.code.toLowerCase().includes(t))
              .slice(0, 6)
              .map((c) => ({
                type: "client" as const,
                id: c.id,
                title: c.name,
                subtitle: `${c.code} · ${c.billingAddress.city || "—"}`,
                href: `/clients/${c.id}`,
              }))
          : [];
        return [...leadHits, ...clientHits];
      },
    },

    notifications: {
      async list() {
        await delay();
        const user = requireUser();
        const dayStart = new Date(now());
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = dayStart.getTime() + 86_400_000;
        const mine = state.leads.filter(
          (l) => l.ownerId === user.id && OPEN_STAGES.includes(l.stage) && l.nextFollowUpAt,
        );
        const out: Notification[] = [];
        for (const l of mine) {
          const at = Date.parse(l.nextFollowUpAt!);
          if (at < dayStart.getTime()) {
            out.push({
              id: `n_over_${l.id}_${l.nextFollowUpAt}`,
              kind: "follow_up_overdue",
              title: `Overdue follow-up: ${l.company ?? l.name}`,
              body: `${l.name} · was due ${new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
              href: `/leads/${l.id}`,
              createdAt: l.nextFollowUpAt!,
              read: false,
            });
          } else if (at < dayEnd) {
            out.push({
              id: `n_today_${l.id}_${l.nextFollowUpAt}`,
              kind: "follow_up_today",
              title: `Follow up today: ${l.company ?? l.name}`,
              body: `${l.name} · ${new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`,
              href: `/leads/${l.id}`,
              createdAt: l.nextFollowUpAt!,
              read: false,
            });
          }
        }
        const weekAgo = now().getTime() - 7 * 86_400_000;
        for (const a of state.activities) {
          if (
            a.type === "assignment" &&
            a.meta.to === user.id &&
            a.actorId !== user.id &&
            Date.parse(a.occurredAt) >= weekAgo
          ) {
            const lead = state.leads.find((l) => l.id === a.entityId);
            if (lead && lead.ownerId === user.id && OPEN_STAGES.includes(lead.stage))
              out.push({
                id: `n_asg_${a.id}`,
                kind: "assignment",
                title: `New lead assigned: ${lead.company ?? lead.name}`,
                body: a.summary,
                href: `/leads/${lead.id}`,
                createdAt: a.occurredAt,
                read: false,
              });
          }
        }
        const read = new Set(state.readNotifications[user.id] ?? []);
        return out
          .map((n) => ({ ...n, read: read.has(n.id) }))
          .sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, 30);
      },
      async markRead(ids) {
        await delay();
        const user = requireUser();
        state.readNotifications[user.id] = Array.from(
          new Set([...(state.readNotifications[user.id] ?? []), ...ids]),
        );
        save();
      },
    },
  };

  return api;
}
