import type {
  Activity,
  Client,
  ClientInput,
  ClientListQuery,
  ConvertLeadInput,
  DashboardSummary,
  DuplicateCheckResult,
  Lead,
  LeadExport,
  LeadPage,
  LeadInput,
  LeadListQuery,
  LeadStage,
  LogActivityInput,
  Notification,
  Paginated,
  SearchResult,
  PublicUser,
  User,
} from "./contracts";
import type { DataMode } from "@/lib/config/env";

/**
 * The single data-access contract for the UI. Two implementations exist:
 *  - DemoApiClient (src/lib/mock) — in-browser, seeded, clearly labelled.
 *  - HttpApiClient (./http-adapter) — calls the real backend at /api/v1.
 * Both enforce the same authorization semantics so UI behaviour is identical.
 */
export interface ApiClient {
  readonly mode: DataMode;

  leads: {
    list(query: LeadListQuery): Promise<LeadPage>;
    get(id: string): Promise<Lead>;
    create(input: LeadInput): Promise<Lead>;
    update(id: string, input: LeadInput): Promise<Lead>;
    assign(ids: string[], ownerId: string): Promise<{ updated: number }>;
    /** All-or-nothing. "won" is only reachable through convert; "lost" needs a per-lead reason. */
    bulkChangeStage(ids: string[], stage: LeadStage): Promise<{ updated: number }>;
    /** Requires leads.export; audited server-side. */
    export(query: LeadListQuery): Promise<LeadExport>;
    changeStage(id: string, stage: LeadStage, opts?: { lostReason?: string }): Promise<Lead>;
    findDuplicates(
      input: Pick<LeadInput, "phone" | "email" | "company">,
      excludeId?: string,
    ): Promise<DuplicateCheckResult>;
    activities(id: string): Promise<Activity[]>;
    logActivity(id: string, input: LogActivityInput): Promise<Activity>;
    scheduleFollowUp(id: string, at: string, note?: string): Promise<Lead>;
    completeFollowUp(id: string, outcome: string, nextAt: string | null): Promise<Lead>;
    convert(id: string, input: ConvertLeadInput): Promise<{ lead: Lead; client: Client }>;
  };

  clients: {
    list(query: ClientListQuery): Promise<Paginated<Client>>;
    get(id: string): Promise<Client>;
    create(input: ClientInput): Promise<Client>;
    update(id: string, input: ClientInput): Promise<Client>;
    timeline(id: string): Promise<Activity[]>;
  };

  users: {
    /** Users the current principal may assign records to. */
    assignable(): Promise<User[]>;
    directory(): Promise<PublicUser[]>;
  };

  dashboard: { summary(): Promise<DashboardSummary> };
  search: { query(term: string): Promise<SearchResult[]> };
  notifications: { list(): Promise<Notification[]>; markRead(ids: string[]): Promise<void> };
}
