"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarCheck, Mail, MessageSquareText, Phone, Users2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Segmented,
} from "@/components/ui/misc";
import {
  CLIENT_CATEGORIES,
  LOST_REASONS,
  stageMeta,
  type ClientCategory,
  type Lead,
  type LeadStage,
} from "@/lib/api/contracts";
import { userMessage } from "@/lib/api/errors";
import {
  useAssignLeads,
  useAssignableUsers,
  useChangeStage,
  useCompleteFollowUp,
  useConvertLead,
  useLogActivity,
  useScheduleFollowUp,
  useUserDirectory,
} from "./hooks";
import { useRouter } from "next/navigation";

const localNowPlus = (days: number, hour = 11) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return format(d, "yyyy-MM-dd'T'HH:mm");
};

export function AssignDialog({
  leadIds,
  open,
  onOpenChange,
  onDone,
}: {
  leadIds: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const users = useAssignableUsers();
  const assign = useAssignLeads();
  const [ownerId, setOwnerId] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Assign {leadIds.length === 1 ? "lead" : `${leadIds.length} leads`}
          </DialogTitle>
          <DialogDescription>
            The new owner is notified and the change is recorded on each lead.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="New owner" htmlFor="assign-owner">
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="assign-owner">
                <SelectValue placeholder={users.isLoading ? "Loading…" : "Choose a person"} />
              </SelectTrigger>
              <SelectContent>
                {(users.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ownerId}
            loading={assign.isPending}
            onClick={async () => {
              try {
                const r = await assign.mutateAsync({ ids: leadIds, ownerId });
                toast.success(
                  r.updated === 0
                    ? "Already assigned to that person"
                    : `${r.updated} lead${r.updated > 1 ? "s" : ""} reassigned`,
                );
                onOpenChange(false);
                onDone?.();
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LostReasonDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Pick<Lead, "id" | "code">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const change = useChangeStage();
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const finalReason = reason === "Other" ? other.trim() : reason;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {lead.code} as lost</DialogTitle>
          <DialogDescription>
            Lost reasons feed the conversion analytics, so pick the closest one.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Reason" htmlFor="lost-reason" required>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="lost-reason">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {reason === "Other" && (
            <Field label="Describe the reason" htmlFor="lost-other" required>
              <Input
                id="lost-other"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                maxLength={160}
                autoFocus
              />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!finalReason}
            loading={change.isPending}
            onClick={async () => {
              try {
                await change.mutateAsync({ id: lead.id, stage: "lost", lostReason: finalReason });
                toast.success(`${lead.code} marked as lost`);
                onOpenChange(false);
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            Mark as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Stage change that routes "lost" through the reason dialog. */
export function useStageChanger() {
  const router = useRouter();
  const change = useChangeStage();
  const [lostFor, setLostFor] = useState<Pick<Lead, "id" | "code"> | null>(null);
  const changeStage = async (lead: Pick<Lead, "id" | "code" | "stage">, stage: LeadStage) => {
    if (stage === lead.stage) return;
    if (stage === "lost") return setLostFor(lead);
    if (stage === "won") {
      toast.info(`Open ${lead.code} and use “Convert to client” to mark it won.`, {
        action: { label: "Open lead", onClick: () => router.push(`/leads/${lead.id}`) },
      });
      return;
    }
    try {
      await change.mutateAsync({ id: lead.id, stage });
      toast.success(`${lead.code} moved to ${stageMeta(stage).label}`);
    } catch (e) {
      toast.error(userMessage(e));
    }
  };
  const dialog = lostFor ? (
    <LostReasonDialog lead={lostFor} open onOpenChange={(o) => !o && setLostFor(null)} />
  ) : null;
  return { changeStage, dialog, pending: change.isPending };
}

export function LogActivityDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const log = useLogActivity(leadId);
  const [type, setType] = useState<"call" | "meeting" | "note" | "email">("call");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const reset = () => {
    setSummary("");
    setBody("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>
            Record what happened so the next person has context.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented
            label="Activity type"
            value={type}
            onChange={setType}
            options={[
              { value: "call", label: "Call", icon: <Phone /> },
              { value: "meeting", label: "Meeting", icon: <Users2 /> },
              { value: "email", label: "Email", icon: <Mail /> },
              { value: "note", label: "Note", icon: <MessageSquareText /> },
            ]}
          />
          <Field label="Summary" htmlFor="act-summary" required>
            <Input
              id="act-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={200}
              placeholder="Discussed pricing for 3 outlets"
              autoFocus
            />
          </Field>
          <Field label="Details" htmlFor="act-body">
            <Textarea
              id="act-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={summary.trim().length < 2}
            loading={log.isPending}
            onClick={async () => {
              try {
                await log.mutateAsync({ type, summary, body: body || undefined });
                toast.success("Activity logged");
                onOpenChange(false);
                reset();
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            Log activity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleFollowUpDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const schedule = useScheduleFollowUp(leadId);
  const [at, setAt] = useState(localNowPlus(1));
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule follow-up</DialogTitle>
          <DialogDescription>The owner gets a reminder when it falls due.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {[
              { l: "Tomorrow", d: 1 },
              { l: "In 3 days", d: 3 },
              { l: "Next week", d: 7 },
            ].map((o) => (
              <Button
                key={o.l}
                size="xs"
                variant="secondary"
                onClick={() => setAt(localNowPlus(o.d))}
              >
                {o.l}
              </Button>
            ))}
          </div>
          <Field label="When" htmlFor="fu-at" required>
            <Input
              id="fu-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="fu-note">
            <Input
              id="fu-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Share revised quote"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!at}
            loading={schedule.isPending}
            onClick={async () => {
              try {
                await schedule.mutateAsync({
                  at: new Date(at).toISOString(),
                  note: note || undefined,
                });
                toast.success("Follow-up scheduled");
                onOpenChange(false);
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteFollowUpDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Pick<Lead, "id" | "code" | "name" | "company">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const complete = useCompleteFollowUp();
  const [outcome, setOutcome] = useState("");
  const [next, setNext] = useState<"none" | "custom">("custom");
  const [at, setAt] = useState(localNowPlus(3));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete follow-up</DialogTitle>
          <DialogDescription>
            {lead.company ?? lead.name} · {lead.code}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Outcome" htmlFor="fu-outcome" required>
            <Textarea
              id="fu-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              rows={3}
              placeholder="Owner agreed to a demo on Friday"
              autoFocus
            />
          </Field>
          <Segmented
            label="Next step"
            value={next}
            onChange={setNext}
            options={[
              { value: "custom", label: "Schedule next" },
              { value: "none", label: "No further follow-up" },
            ]}
          />
          {next === "custom" && (
            <Field label="Next follow-up" htmlFor="fu-next">
              <Input
                id="fu-next"
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!outcome.trim() || (next === "custom" && !at)}
            loading={complete.isPending}
            onClick={async () => {
              try {
                await complete.mutateAsync({
                  id: lead.id,
                  outcome,
                  nextAt: next === "custom" ? new Date(at).toISOString() : null,
                });
                toast.success("Follow-up completed");
                onOpenChange(false);
                setOutcome("");
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            <CalendarCheck /> Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const convert = useConvertLead(lead.id);
  const dir = useUserDirectory();
  const managers = (dir.data ?? []).filter((u) =>
    u.roles.some((r) => r === "account_manager" || r === "sales_manager" || r === "founder"),
  );
  const [clientName, setClientName] = useState(lead.company ?? lead.name);
  const [legalName, setLegalName] = useState(lead.company ?? lead.name);
  const [industry, setIndustry] = useState("");
  const [category, setCategory] = useState<ClientCategory>("smb");
  const [am, setAm] = useState("");
  const valid =
    clientName.trim().length >= 2 &&
    legalName.trim().length >= 2 &&
    industry.trim().length >= 2 &&
    !!am;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Convert {lead.code} to a client</DialogTitle>
          <DialogDescription>
            Creates the client record, marks the lead as won and links both histories. Billing
            details (GSTIN, address) can be completed on the client profile.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" htmlFor="cv-name" required>
            <Input
              id="cv-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </Field>
          <Field label="Legal name" htmlFor="cv-legal" required hint="As on GST registration">
            <Input id="cv-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
          <Field label="Industry" htmlFor="cv-industry" required>
            <Input
              id="cv-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Restaurants"
            />
          </Field>
          <Field label="Category" htmlFor="cv-cat">
            <Select value={category} onValueChange={(v) => setCategory(v as ClientCategory)}>
              <SelectTrigger id="cv-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLIENT_CATEGORIES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Account manager" htmlFor="cv-am" required className="sm:col-span-2">
            <Select value={am} onValueChange={setAm}>
              <SelectTrigger id="cv-am">
                <SelectValue placeholder="Choose account manager" />
              </SelectTrigger>
              <SelectContent>
                {managers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={convert.isPending}
            onClick={async () => {
              try {
                const r = await convert.mutateAsync({
                  clientName,
                  legalName,
                  industry,
                  category,
                  accountManagerId: am,
                });
                toast.success(`Client ${r.client.code} created`, {
                  action: { label: "Open", onClick: () => router.push(`/clients/${r.client.id}`) },
                });
                onOpenChange(false);
              } catch (e) {
                toast.error(userMessage(e));
              }
            }}
          >
            Convert to client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
