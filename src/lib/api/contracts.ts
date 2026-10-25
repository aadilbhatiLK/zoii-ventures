/**
 * Typed API contracts shared by the demo adapter, the HTTP adapter and the UI.
 * The backend (Sprint 2) must implement exactly these shapes under /api/v1.
 * See docs/api-contracts.md for endpoints.
 */
import { z } from "zod";
import { ROLES, type Role } from "@/lib/permissions";
import { validateGstin } from "@/lib/validation/gstin";

// ---------- primitives ----------

/** Money is a decimal string with up to 2 places, e.g. "125000.00". Never a float. */
export const MoneySchema = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount like 125000 or 125000.50");
export type Money = z.infer<typeof MoneySchema>;

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{7,16}[0-9]$/, "Enter a valid phone number");

const OptionalEmail = z
  .union([z.literal(""), z.email("Enter a valid email")])
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined));

const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// ---------- reference enums ----------

export const PRODUCT_LINES = {
  ecommerce: "E-commerce website",
  pos: "Restaurant & grocery POS",
  kuicko_solutions: "Kuicko business solutions",
  social_media: "Social media & digital marketing",
  custom_software: "Custom software / apps",
  jewellery_crm: "Jewellery CRM",
  outdoor_media_crm: "Outdoor media CRM",
  wedding_card_erp: "Wedding-card wholesale ERP",
  other: "Other",
} as const;
export type ProductLine = keyof typeof PRODUCT_LINES;
export const ProductLineSchema = z.enum(
  Object.keys(PRODUCT_LINES) as [ProductLine, ...ProductLine[]],
);

export const LEAD_STAGES = [
  { key: "new", label: "New", probability: 5 },
  { key: "contacted", label: "Contacted", probability: 10 },
  { key: "qualified", label: "Qualified", probability: 25 },
  { key: "discovery", label: "Discovery", probability: 40 },
  { key: "proposal", label: "Proposal", probability: 55 },
  { key: "negotiation", label: "Negotiation", probability: 75 },
  { key: "won", label: "Won", probability: 100 },
  { key: "lost", label: "Lost", probability: 0 },
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]["key"];
export const LeadStageSchema = z.enum(LEAD_STAGES.map((s) => s.key) as [LeadStage, ...LeadStage[]]);
export const OPEN_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
];
export function stageMeta(stage: LeadStage) {
  return LEAD_STAGES.find((s) => s.key === stage) ?? LEAD_STAGES[0];
}

export const LEAD_SOURCES = {
  website: "Website",
  referral: "Referral",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook_ads: "Facebook ads",
  google_ads: "Google ads",
  cold_call: "Cold call",
  walk_in: "Walk-in",
  event: "Event",
  partner: "Partner",
  other: "Other",
} as const;
export type LeadSource = keyof typeof LEAD_SOURCES;
export const LeadSourceSchema = z.enum(Object.keys(LEAD_SOURCES) as [LeadSource, ...LeadSource[]]);

export const PRIORITIES = { low: "Low", medium: "Medium", high: "High" } as const;
export type Priority = keyof typeof PRIORITIES;
export const PrioritySchema = z.enum(["low", "medium", "high"]);

export const LOST_REASONS = [
  "Budget",
  "Chose a competitor",
  "No response",
  "Timing / postponed",
  "Requirement mismatch",
  "Other",
] as const;

// ---------- users & session ----------

export const RoleSchema = z.enum(Object.keys(ROLES) as [Role, ...Role[]]);

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  title: z.string(),
  roles: z.array(RoleSchema).min(1),
  teamId: z.string().nullable(),
  avatarHue: z.number().int().min(0).max(360),
  mfaEnrolled: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  user: UserSchema,
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  mfaSatisfied: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

// ---------- leads ----------

export const LeadSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string(),
  city: z.string().nullable(),
  productInterest: z.array(ProductLineSchema).min(1),
  source: LeadSourceSchema,
  campaign: z.string().nullable(),
  stage: LeadStageSchema,
  priority: PrioritySchema,
  score: z.number().int().min(0).max(100),
  estimatedValue: MoneySchema,
  ownerId: z.string(),
  nextFollowUpAt: IsoDateTimeSchema.nullable(),
  lostReason: z.string().nullable(),
  clientId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  createdById: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadInputSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  company: OptionalText(160),
  email: OptionalEmail,
  phone: PhoneSchema,
  city: OptionalText(80),
  productInterest: z.array(ProductLineSchema).min(1, "Pick at least one product or service"),
  source: LeadSourceSchema,
  campaign: OptionalText(120),
  priority: PrioritySchema,
  estimatedValue: MoneySchema,
  ownerId: z.string().min(1, "Choose an owner"),
  nextFollowUpAt: IsoDateTimeSchema.nullable().optional(),
  notes: OptionalText(2000),
});
export type LeadInput = z.input<typeof LeadInputSchema>;
export type LeadInputParsed = z.output<typeof LeadInputSchema>;

export const LeadSortFieldSchema = z.enum([
  "createdAt",
  "estimatedValue",
  "score",
  "nextFollowUpAt",
  "name",
]);
export type LeadSortField = z.infer<typeof LeadSortFieldSchema>;

export const LeadListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20),
  sort: z.object({ field: LeadSortFieldSchema, dir: z.enum(["asc", "desc"]) }).optional(),
  stage: z.array(LeadStageSchema).optional(),
  productLine: z.array(ProductLineSchema).optional(),
  ownerId: z.array(z.string()).optional(),
  source: z.array(LeadSourceSchema).optional(),
  priority: z.array(PrioritySchema).optional(),
  view: z.enum(["all", "mine", "due_today", "overdue", "hot", "open"]).optional(),
});
export type LeadListQuery = z.input<typeof LeadListQuerySchema>;

export const ActivityTypeSchema = z.enum([
  "created",
  "note",
  "call",
  "meeting",
  "email",
  "stage_change",
  "assignment",
  "follow_up_scheduled",
  "follow_up_completed",
  "converted",
  "updated",
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  entityType: z.enum(["lead", "client"]),
  entityId: z.string(),
  type: ActivityTypeSchema,
  summary: z.string(),
  body: z.string().nullable(),
  actorId: z.string(),
  occurredAt: IsoDateTimeSchema,
  meta: z.record(z.string(), z.string()),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const LogActivityInputSchema = z.object({
  type: z.enum(["note", "call", "meeting", "email"]),
  summary: z.string().trim().min(2, "Add a short summary").max(200),
  body: OptionalText(4000),
  occurredAt: IsoDateTimeSchema.optional(),
});
export type LogActivityInput = z.input<typeof LogActivityInputSchema>;

export const DuplicateMatchSchema = z.object({
  lead: LeadSchema.pick({
    id: true,
    code: true,
    name: true,
    company: true,
    phone: true,
    email: true,
    stage: true,
  }),
  matchedOn: z.array(z.enum(["phone", "email", "company"])),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

/** Matches the caller cannot see are counted, never revealed (no data leakage). */
export interface DuplicateCheckResult {
  matches: DuplicateMatch[];
  hiddenMatchCount: number;
}

// ---------- clients ----------

export const CLIENT_CATEGORIES = {
  startup: "Startup",
  smb: "Small business",
  mid_market: "Mid-market",
  enterprise: "Enterprise",
  government: "Government / institution",
} as const;
export type ClientCategory = keyof typeof CLIENT_CATEGORIES;

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  designation: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  isDecisionMaker: z.boolean(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});
export type Address = z.infer<typeof AddressSchema>;

export const ClientSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  legalName: z.string(),
  industry: z.string(),
  category: z.enum(Object.keys(CLIENT_CATEGORIES) as [ClientCategory, ...ClientCategory[]]),
  status: z.enum(["onboarding", "active", "inactive"]),
  accountManagerId: z.string(),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  billingAddress: AddressSchema,
  website: z.string().nullable(),
  contacts: z.array(ContactSchema),
  productLines: z.array(ProductLineSchema),
  sourceLeadId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Client = z.infer<typeof ClientSchema>;

const GstinField = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .superRefine((v, ctx) => {
    if (!v) return;
    const check = validateGstin(v);
    if (!check.valid) ctx.addIssue({ code: "custom", message: check.reason });
  });

export const ClientInputSchema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(160),
  legalName: z.string().trim().min(2, "Legal name is required").max(200),
  industry: z.string().trim().min(2, "Industry is required").max(80),
  category: ClientSchema.shape.category,
  status: ClientSchema.shape.status,
  accountManagerId: z.string().min(1, "Choose an account manager"),
  gstin: GstinField,
  website: OptionalText(200),
  billingAddress: z.object({
    line1: z.string().trim().min(3, "Address is required").max(200),
    line2: OptionalText(200),
    city: z.string().trim().min(2, "City is required").max(80),
    state: z.string().trim().min(2, "State is required").max(80),
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code"),
  }),
  productLines: z.array(ProductLineSchema),
  primaryContact: z.object({
    name: z.string().trim().min(2, "Contact name is required").max(120),
    designation: OptionalText(80),
    email: OptionalEmail,
    phone: PhoneSchema,
  }),
});
export type ClientInput = z.input<typeof ClientInputSchema>;
export type ClientInputParsed = z.output<typeof ClientInputSchema>;

export const ClientListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20),
  status: z.array(ClientSchema.shape.status).optional(),
  category: z.array(ClientSchema.shape.category).optional(),
});
export type ClientListQuery = z.input<typeof ClientListQuerySchema>;

export const ConvertLeadInputSchema = z.object({
  clientName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().min(2).max(200),
  industry: z.string().trim().min(2).max(80),
  category: ClientSchema.shape.category,
  accountManagerId: z.string().min(1),
});
export type ConvertLeadInput = z.input<typeof ConvertLeadInputSchema>;

// ---------- shared ----------

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardSummary {
  generatedAt: string;
  /** "demo" when produced by the demo adapter. The UI labels it. */
  dataOrigin: "demo" | "live";
  scope: "company" | "team" | "own";
  pipeline: {
    openCount: number;
    openValue: Money;
    weightedValue: Money;
    byStage: { stage: LeadStage; count: number; value: Money }[];
    byProductLine: { productLine: ProductLine; count: number; value: Money }[];
  };
  conversion: { leadsCreated90d: number; won90d: number; lost90d: number; rate: number };
  wonThisMonth: { count: number; value: Money };
  followUps: { overdue: number; dueToday: number };
  /** Finance series exists only once the finance module ships; the demo provides a labelled fixture. */
  revenueSeries: {
    origin: "fixture" | "ledger";
    points: { month: string; invoiced: Money; collected: Money }[];
  } | null;
  ownerLeaderboard: { ownerId: string; open: number; won: number; wonValue: Money }[];
}

export interface Notification {
  id: string;
  kind: "follow_up_overdue" | "follow_up_today" | "assignment" | "system";
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
}

export interface SearchResult {
  type: "lead" | "client";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "NETWORK"
  | "CONFIG";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, string[]>;
  requestId?: string;
}
