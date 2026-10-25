/**
 * DEMO DATA ONLY. Every person, company and amount below is fictional and exists so
 * the interface can be evaluated before the backend ships. The UI labels this data
 * as demo wherever it appears. Generation is deterministic (fixed PRNG seed); dates
 * are relative to the moment the demo store is created.
 */
import type {
  Activity,
  Client,
  Lead,
  LeadSource,
  LeadStage,
  Priority,
  ProductLine,
  User,
} from "@/lib/api/contracts";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_PASSWORD = "zoii-demo";
export const DEMO_OTP = "000000";

export const DEMO_USERS: User[] = [
  {
    id: "u_founder",
    name: "Riya Kapoor",
    email: "founder@demo.zoii.in",
    phone: "+91 90000 00001",
    title: "Founder & Director",
    roles: ["founder"],
    teamId: null,
    avatarHue: 262,
    mfaEnrolled: true,
  },
  {
    id: "u_admin",
    name: "System Admin",
    email: "admin@demo.zoii.in",
    phone: "+91 90000 00002",
    title: "Platform administrator",
    roles: ["super_admin"],
    teamId: null,
    avatarHue: 210,
    mfaEnrolled: true,
  },
  {
    id: "u_salesmgr",
    name: "Arjun Rathore",
    email: "sales.manager@demo.zoii.in",
    phone: "+91 90000 00003",
    title: "Sales Manager",
    roles: ["sales_manager"],
    teamId: "t_growth",
    avatarHue: 24,
    mfaEnrolled: false,
  },
  {
    id: "u_sales1",
    name: "Neha Joshi",
    email: "neha@demo.zoii.in",
    phone: "+91 90000 00004",
    title: "Sales Executive",
    roles: ["sales_executive"],
    teamId: "t_growth",
    avatarHue: 330,
    mfaEnrolled: false,
  },
  {
    id: "u_sales2",
    name: "Kabir Solanki",
    email: "kabir@demo.zoii.in",
    phone: "+91 90000 00005",
    title: "Sales Executive",
    roles: ["sales_executive"],
    teamId: "t_growth",
    avatarHue: 160,
    mfaEnrolled: false,
  },
  {
    id: "u_am",
    name: "Pooja Vyas",
    email: "pooja@demo.zoii.in",
    phone: "+91 90000 00006",
    title: "Account Manager",
    roles: ["account_manager"],
    teamId: "t_accounts",
    avatarHue: 190,
    mfaEnrolled: false,
  },
  {
    id: "u_fin",
    name: "Vikram Bhati",
    email: "finance@demo.zoii.in",
    phone: "+91 90000 00007",
    title: "Finance Manager",
    roles: ["finance_manager"],
    teamId: "t_finance",
    avatarHue: 95,
    mfaEnrolled: true,
  },
  {
    id: "u_pm",
    name: "Ishaan Purohit",
    email: "pm@demo.zoii.in",
    phone: "+91 90000 00008",
    title: "Project Manager",
    roles: ["project_manager"],
    teamId: "t_delivery",
    avatarHue: 45,
    mfaEnrolled: false,
  },
  {
    id: "u_hr",
    name: "Meera Shekhawat",
    email: "hr@demo.zoii.in",
    phone: "+91 90000 00009",
    title: "HR Manager",
    roles: ["hr_manager"],
    teamId: "t_people",
    avatarHue: 300,
    mfaEnrolled: true,
  },
  {
    id: "u_auditor",
    name: "Audit Reader",
    email: "auditor@demo.zoii.in",
    phone: "+91 90000 00010",
    title: "External auditor (read-only)",
    roles: ["auditor"],
    teamId: null,
    avatarHue: 0,
    mfaEnrolled: true,
  },
  {
    id: "u_acct",
    name: "Sonal Mehta",
    email: "accounts@demo.zoii.in",
    phone: "+91 90000 00011",
    title: "Accountant",
    roles: ["accountant"],
    teamId: "t_finance",
    avatarHue: 120,
    mfaEnrolled: false,
  },
  {
    id: "u_dev",
    name: "Rohan Gehlot",
    email: "dev@demo.zoii.in",
    phone: "+91 90000 00012",
    title: "Software Engineer",
    roles: ["employee"],
    teamId: "t_delivery",
    avatarHue: 280,
    mfaEnrolled: false,
  },
];

const COMPANIES: { name: string; city: string; product: ProductLine; industry: string }[] = [
  {
    name: "Marudhar Sweets & Namkeen",
    city: "Bikaner",
    product: "pos",
    industry: "Food & beverage",
  },
  {
    name: "Shree Laxmi Jewellers",
    city: "Jodhpur",
    product: "jewellery_crm",
    industry: "Jewellery",
  },
  {
    name: "Thar Outdoor Media",
    city: "Jaipur",
    product: "outdoor_media_crm",
    industry: "Advertising",
  },
  {
    name: "Kesar Wedding Cards",
    city: "Bikaner",
    product: "wedding_card_erp",
    industry: "Printing",
  },
  { name: "Desert Brew Café", city: "Jaisalmer", product: "pos", industry: "Restaurants" },
  {
    name: "Ganpati Fresh Mart",
    city: "Amalner",
    product: "kuicko_solutions",
    industry: "Grocery retail",
  },
  { name: "Rajwada Handicrafts", city: "Udaipur", product: "ecommerce", industry: "Handicrafts" },
  { name: "Vardhman Textiles", city: "Bhilwara", product: "custom_software", industry: "Textiles" },
  {
    name: "Sunrise Coaching Classes",
    city: "Kota",
    product: "social_media",
    industry: "Education",
  },
  {
    name: "Navkar Gold Palace",
    city: "Ahmedabad",
    product: "jewellery_crm",
    industry: "Jewellery",
  },
  { name: "Chopda Kirana Bazaar", city: "Chopda", product: "pos", industry: "Grocery retail" },
  {
    name: "Aravali Diagnostics",
    city: "Ajmer",
    product: "custom_software",
    industry: "Healthcare",
  },
  {
    name: "Mewar Hoardings",
    city: "Udaipur",
    product: "outdoor_media_crm",
    industry: "Advertising",
  },
  {
    name: "Shubh Vivah Invitations",
    city: "Jaipur",
    product: "wedding_card_erp",
    industry: "Printing",
  },
  { name: "Lotus Organics", city: "Indore", product: "ecommerce", industry: "FMCG" },
  {
    name: "Bikaner Bhujia House",
    city: "Bikaner",
    product: "social_media",
    industry: "Food & beverage",
  },
  {
    name: "Jalgaon Banana Traders",
    city: "Jalgaon",
    product: "custom_software",
    industry: "Agri trade",
  },
  { name: "Royal Rasoi Restaurant", city: "Jodhpur", product: "pos", industry: "Restaurants" },
  {
    name: "Tanishka Silver Arts",
    city: "Bikaner",
    product: "jewellery_crm",
    industry: "Jewellery",
  },
  { name: "Pink City Realty", city: "Jaipur", product: "custom_software", industry: "Real estate" },
  { name: "Saffron Fitness Studio", city: "Jodhpur", product: "social_media", industry: "Fitness" },
  { name: "Om Sai Medicos", city: "Amalner", product: "kuicko_solutions", industry: "Pharmacy" },
  {
    name: "Heritage Haveli Stays",
    city: "Jaisalmer",
    product: "ecommerce",
    industry: "Hospitality",
  },
  { name: "Shekhawati Printers", city: "Sikar", product: "wedding_card_erp", industry: "Printing" },
  { name: "Urban Tadka Cloud Kitchen", city: "Jaipur", product: "pos", industry: "Restaurants" },
  { name: "Kanha Dairy Products", city: "Nagaur", product: "kuicko_solutions", industry: "Dairy" },
  {
    name: "Mahaveer Steel Furniture",
    city: "Bikaner",
    product: "ecommerce",
    industry: "Furniture",
  },
  { name: "Blue City Tours", city: "Jodhpur", product: "social_media", industry: "Travel" },
  { name: "Ratnam Diamonds", city: "Surat", product: "jewellery_crm", industry: "Jewellery" },
  {
    name: "Marwar Signage Co.",
    city: "Jodhpur",
    product: "outdoor_media_crm",
    industry: "Advertising",
  },
  {
    name: "Sanjivani Hospital",
    city: "Bikaner",
    product: "custom_software",
    industry: "Healthcare",
  },
  { name: "Golden Crust Bakery", city: "Udaipur", product: "pos", industry: "Bakery" },
  { name: "Rangoli Sarees", city: "Bhilwara", product: "ecommerce", industry: "Apparel" },
  { name: "Swastik Card Mart", city: "Bikaner", product: "wedding_card_erp", industry: "Printing" },
  { name: "Krishna Super Bazaar", city: "Chopda", product: "pos", industry: "Grocery retail" },
  { name: "Apex Builders", city: "Jaipur", product: "social_media", industry: "Real estate" },
  {
    name: "Zaika Biryani House",
    city: "Amalner",
    product: "kuicko_solutions",
    industry: "Restaurants",
  },
  { name: "Mohan Opticals", city: "Ajmer", product: "social_media", industry: "Retail" },
  {
    name: "Vasundhara Agro",
    city: "Sri Ganganagar",
    product: "custom_software",
    industry: "Agri trade",
  },
  { name: "Neelkanth Electronics", city: "Bikaner", product: "ecommerce", industry: "Electronics" },
];

const FIRST = [
  "Rahul",
  "Priya",
  "Sandeep",
  "Anita",
  "Mahesh",
  "Kavita",
  "Deepak",
  "Sunita",
  "Ramesh",
  "Pallavi",
  "Vivek",
  "Rekha",
  "Amit",
  "Sonal",
  "Harish",
  "Nidhi",
  "Gaurav",
  "Jyoti",
  "Manoj",
  "Shweta",
];
const LAST = [
  "Agarwal",
  "Sharma",
  "Jain",
  "Mehta",
  "Choudhary",
  "Patil",
  "Soni",
  "Gupta",
  "Bansal",
  "Rathi",
  "Khatri",
  "Purohit",
  "Deshmukh",
  "Maheshwari",
  "Kothari",
];
const SOURCES: LeadSource[] = [
  "website",
  "referral",
  "whatsapp",
  "instagram",
  "facebook_ads",
  "google_ads",
  "cold_call",
  "walk_in",
  "event",
  "partner",
];
const OWNERS = ["u_sales1", "u_sales2", "u_salesmgr", "u_founder", "u_sales1", "u_sales2"];

const VALUE_BY_PRODUCT: Record<ProductLine, [number, number]> = {
  ecommerce: [45_000, 2_50_000],
  pos: [18_000, 1_20_000],
  kuicko_solutions: [12_000, 80_000],
  social_media: [15_000, 90_000],
  custom_software: [2_50_000, 18_00_000],
  jewellery_crm: [80_000, 4_50_000],
  outdoor_media_crm: [1_20_000, 6_00_000],
  wedding_card_erp: [90_000, 5_00_000],
  other: [20_000, 1_00_000],
};

// Weighted towards early stages, like a real funnel.
const STAGE_BAG: LeadStage[] = [
  "new",
  "new",
  "new",
  "new",
  "contacted",
  "contacted",
  "contacted",
  "qualified",
  "qualified",
  "qualified",
  "discovery",
  "discovery",
  "proposal",
  "proposal",
  "negotiation",
  "won",
  "won",
  "lost",
  "lost",
];

export interface DemoSeed {
  users: User[];
  leads: Lead[];
  clients: Client[];
  activities: Activity[];
}

export function buildDemoSeed(now: Date = new Date()): DemoSeed {
  const rand = mulberry32(20261025);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const between = (min: number, max: number) =>
    Math.round((min + rand() * (max - min)) / 1000) * 1000;
  const day = 86_400_000;
  const iso = (offsetDays: number, hour = 11) => {
    const d = new Date(now.getTime() + offsetDays * day);
    d.setHours(hour, Math.floor(rand() * 4) * 15, 0, 0);
    return d.toISOString();
  };

  const leads: Lead[] = [];
  const activities: Activity[] = [];
  const clients: Client[] = [];
  let activitySeq = 1;
  const addActivity = (a: Omit<Activity, "id">) =>
    activities.push({ ...a, id: `act_${activitySeq++}` });

  const total = 72;
  for (let i = 0; i < total; i++) {
    const company = COMPANIES[i % COMPANIES.length]!;
    const product: ProductLine =
      rand() < 0.82 ? company.product : pick(Object.keys(VALUE_BY_PRODUCT) as ProductLine[]);
    const extra: ProductLine[] = rand() < 0.25 ? ["social_media"] : [];
    const interest = Array.from(new Set([product, ...extra]));
    const stage = pick(STAGE_BAG);
    const priority: Priority = rand() < 0.25 ? "high" : rand() < 0.6 ? "medium" : "low";
    const source = pick(SOURCES);
    const ownerId = pick(OWNERS);
    const createdOffset = -Math.floor(4 + rand() * 150);
    const [vmin, vmax] = VALUE_BY_PRODUCT[product];
    const value = between(vmin, vmax);
    const contact = `${pick(FIRST)} ${pick(LAST)}`;
    const open = stage !== "won" && stage !== "lost";
    const followRoll = rand();
    const nextFollowUpAt = open
      ? followRoll < 0.22
        ? iso(-Math.ceil(rand() * 6), 10)
        : followRoll < 0.4
          ? iso(0, 12 + Math.floor(rand() * 5))
          : followRoll < 0.9
            ? iso(1 + Math.floor(rand() * 12), 11)
            : null
      : null;
    const id = `lead_${String(i + 1).padStart(3, "0")}`;
    const scoreBase = priority === "high" ? 62 : priority === "medium" ? 42 : 24;
    const score = Math.min(98, scoreBase + Math.floor(rand() * 30));
    const createdAt = iso(createdOffset, 10);
    const updatedAt = iso(Math.min(-1, createdOffset + Math.floor(rand() * 20)), 16);
    const branch = i >= COMPANIES.length ? ` (${company.city} branch)` : "";
    const lead: Lead = {
      id,
      code: `LD-${1001 + i}`,
      name: contact,
      company: company.name + branch,
      email: rand() < 0.75 ? `${contact.split(" ")[0]!.toLowerCase()}.${i + 1}@example.com` : null,
      phone: `+91 9${String(800000000 + Math.floor(rand() * 199999999)).slice(0, 9)}`,
      city: company.city,
      productInterest: interest,
      source,
      campaign:
        source === "facebook_ads" || source === "instagram"
          ? pick(["Diwali POS offer", "Wedding season 2026", "Jewellery CRM demo week"])
          : null,
      stage,
      priority,
      score,
      estimatedValue: `${value}.00`,
      ownerId,
      nextFollowUpAt,
      closedAt: stage === "won" || stage === "lost" ? updatedAt : null,
      lostReason:
        stage === "lost"
          ? pick(["Budget", "Chose a competitor", "No response", "Timing / postponed"])
          : null,
      clientId: null,
      notes: null,
      createdAt,
      updatedAt,
      createdById: ownerId,
    };
    leads.push(lead);

    addActivity({
      entityType: "lead",
      entityId: id,
      type: "created",
      summary: `Lead captured from ${source.replace("_", " ")}`,
      body: null,
      actorId: ownerId,
      occurredAt: createdAt,
      meta: {},
    });
    const touches = 1 + Math.floor(rand() * 3);
    for (let t = 0; t < touches; t++) {
      const type = pick(["call", "note", "meeting", "call"] as const);
      const summary =
        type === "call"
          ? pick([
              "Intro call — shared product overview",
              "Follow-up call, asked for pricing",
              "Discussed onboarding timeline",
              "Call not answered, left WhatsApp message",
            ])
          : type === "meeting"
            ? pick([
                "Demo at client office",
                "Requirement walkthrough with owner",
                "Online demo on Google Meet",
              ])
            : pick([
                "Owner wants GST-ready invoices",
                "Interested in WhatsApp ordering add-on",
                "Needs Hindi interface for staff",
                "Comparing with a local vendor",
              ]);
      addActivity({
        entityType: "lead",
        entityId: id,
        type,
        summary,
        body: null,
        actorId: ownerId,
        occurredAt: iso(createdOffset + 2 + t * 5, 15),
        meta: {},
      });
    }
    if (stage !== "new") {
      addActivity({
        entityType: "lead",
        entityId: id,
        type: "stage_change",
        summary: `Stage moved to ${stage}`,
        body: null,
        actorId: ownerId,
        occurredAt: updatedAt,
        meta: { to: stage },
      });
    }
  }

  // Convert most won leads into clients so client profiles have history.
  const managers = ["u_am", "u_am", "u_salesmgr"];
  let clientSeq = 0;
  for (const lead of leads.filter((l) => l.stage === "won")) {
    // Every won lead has a client: "won" is only reachable through conversion.
    clientSeq++;
    const id = `client_${String(clientSeq).padStart(3, "0")}`;
    const company = COMPANIES.find((c) => lead.company?.startsWith(c.name));
    const createdAt = lead.updatedAt;
    clients.push({
      id,
      code: `CL-${200 + clientSeq}`,
      name: lead.company ?? lead.name,
      legalName: `${lead.company ?? lead.name} (Proprietorship)`,
      industry: company?.industry ?? "Retail",
      category: rand() < 0.7 ? "smb" : "mid_market",
      status: rand() < 0.8 ? "active" : "onboarding",
      accountManagerId: pick(managers),
      gstin: null,
      pan: null,
      billingAddress: {
        line1: `${10 + Math.floor(rand() * 180)}, Main Market Road`,
        line2: null,
        city: lead.city ?? "Bikaner",
        state:
          lead.city === "Amalner" || lead.city === "Chopda" || lead.city === "Jalgaon"
            ? "Maharashtra"
            : lead.city === "Ahmedabad" || lead.city === "Surat"
              ? "Gujarat"
              : lead.city === "Indore"
                ? "Madhya Pradesh"
                : "Rajasthan",
        pincode: String(300000 + Math.floor(rand() * 99999)).slice(0, 6),
      },
      website: null,
      contacts: [
        {
          id: `${id}_c1`,
          name: lead.name,
          designation: "Owner",
          email: lead.email,
          phone: lead.phone,
          isPrimary: true,
          isDecisionMaker: true,
        },
      ],
      productLines: lead.productInterest,
      sourceLeadId: lead.id,
      createdAt,
      updatedAt: createdAt,
    });
    lead.clientId = id;
    addActivity({
      entityType: "client",
      entityId: id,
      type: "converted",
      summary: `Converted from lead ${lead.code}`,
      body: null,
      actorId: lead.ownerId,
      occurredAt: createdAt,
      meta: { leadId: lead.id },
    });
    addActivity({
      entityType: "lead",
      entityId: lead.id,
      type: "converted",
      summary: `Converted to client ${`CL-${200 + clientSeq}`}`,
      body: null,
      actorId: lead.ownerId,
      occurredAt: createdAt,
      meta: { clientId: id },
    });
  }

  return { users: DEMO_USERS.map((u) => ({ ...u })), leads, clients, activities };
}

/**
 * DEMO FIXTURE — invoiced vs collected per month. The finance ledger (Sprint 5) replaces
 * this; until then the dashboard renders it with a "Demo fixture" label.
 */
export function demoRevenueFixture(
  now: Date = new Date(),
): { month: string; invoiced: string; collected: string }[] {
  const rand = mulberry32(7);
  const out: { month: string; invoiced: string; collected: string }[] = [];
  let base = 2_10_000;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    base = base * (1.02 + rand() * 0.09);
    const invoiced = Math.round(base / 100) * 100;
    const collected = Math.round((invoiced * (0.78 + rand() * 0.17)) / 100) * 100;
    out.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      invoiced: `${invoiced}.00`,
      collected: `${collected}.00`,
    });
  }
  return out;
}
