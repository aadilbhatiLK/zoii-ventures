"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
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
import { ConfirmDialog } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/misc";
import {
  LEAD_SOURCES,
  LeadInputSchema,
  PRODUCT_LINES,
  type DuplicateCheckResult,
  type Lead,
  type LeadInput,
  type LeadInputParsed,
  type Priority,
  type ProductLine,
} from "@/lib/api/contracts";
import { getRuntime } from "@/lib/api";
import { isApiError, userMessage } from "@/lib/api/errors";
import { useAuth } from "@/features/auth/auth-provider";
import { useAssignableUsers, useCreateLead, useLead, useUpdateLead } from "./hooks";
import { StageBadge } from "./lead-meta";
import { cn } from "@/lib/utils";

const toLocalInput = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";

function defaults(lead: Lead | undefined, userId: string): LeadInput {
  return {
    name: lead?.name ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    city: lead?.city ?? "",
    productInterest: lead?.productInterest ?? [],
    source: lead?.source ?? "website",
    campaign: lead?.campaign ?? "",
    priority: lead?.priority ?? "medium",
    estimatedValue: lead ? String(Number(lead.estimatedValue)) : "",
    ownerId: lead?.ownerId ?? userId,
    nextFollowUpAt: lead?.nextFollowUpAt ?? null,
    notes: lead?.notes ?? "",
  };
}

export function LeadFormSheet({
  leadId,
  open,
  onClose,
}: {
  leadId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const editing = !!leadId;
  const lead = useLead(leadId ?? "");
  if (editing && !lead.data) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Loading lead</DialogTitle>
          <div className="space-y-4 p-6">
            {lead.isError ? (
              <p className="text-danger text-sm">{userMessage(lead.error)}</p>
            ) : (
              <>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-24" />
              </>
            )}
          </div>
        </SheetContent>
      </Dialog>
    );
  }
  return <LeadForm key={leadId ?? "new"} lead={lead.data} open={open} onClose={onClose} />;
}

function LeadForm({ lead, open, onClose }: { lead?: Lead; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user, can } = useAuth();
  const assignable = useAssignableUsers();
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? "");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dupResult, setDupResult] = useState<DuplicateCheckResult | null>(null);
  const [dupAck, setDupAck] = useState(false);

  const form = useForm<LeadInput, unknown, LeadInputParsed>({
    resolver: zodResolver(LeadInputSchema),
    defaultValues: defaults(lead, user!.id),
    mode: "onTouched",
  });
  const { register, control, handleSubmit, formState, setError, getValues } = form;
  const errors = formState.errors;
  const [phone, email, company] = useWatch({ control, name: ["phone", "email", "company"] });

  // Duplicate detection runs as the identifying fields settle.
  const dupPhone = (phone ?? "").replace(/\D/g, "");
  const dupCompany = (company ?? "").trim();
  const dupEmail = (email ?? "").trim();
  const dupEligible =
    dupPhone.length >= 10 || dupCompany.length >= 4 || /^\S+@\S+\.\S+$/.test(dupEmail);
  const dupes = dupEligible ? dupResult : null;
  useEffect(() => {
    if (!dupEligible) return;
    const e = dupEmail;
    const c = dupCompany;
    const t = setTimeout(() => {
      getRuntime()
        .api.leads.findDuplicates(
          { phone: phone ?? "", email: e || undefined, company: c || undefined },
          lead?.id,
        )
        .then((r) => {
          setDupResult(r.matches.length || r.hiddenMatchCount ? r : null);
          setDupAck(false);
        })
        .catch(() => setDupResult(null));
    }, 450);
    return () => clearTimeout(t);
  }, [dupEligible, phone, dupEmail, dupCompany, lead?.id]);

  const requestClose = () => (formState.isDirty ? setConfirmDiscard(true) : onClose());
  const pending = create.isPending || update.isPending;
  const canAssign = can("leads.assign");
  const ownerOptions = useMemo(() => {
    const list = assignable.data ?? [];
    if (lead && !list.some((u) => u.id === lead.ownerId)) return list; // current owner outside scope: shown via placeholder
    return list;
  }, [assignable.data, lead]);

  const onSubmit = handleSubmit(async (values) => {
    if (!lead && dupes && !dupAck) {
      setDupAck(true);
      toast.warning("Possible duplicate found. Review it, then press “Create anyway”.");
      return;
    }
    try {
      if (lead) {
        await update.mutateAsync({ ...values, expectedUpdatedAt: lead.updatedAt });
        toast.success("Lead updated");
      } else {
        const created = await create.mutateAsync(values);
        toast.success(`Lead ${created.code} created`, {
          action: { label: "Open", onClick: () => router.push(`/leads/${created.id}`) },
        });
      }
      onClose();
    } catch (e) {
      if (isApiError(e) && e.details) {
        for (const [k, msgs] of Object.entries(e.details))
          setError(k as keyof LeadInput, { message: msgs[0] });
      }
      toast.error(userMessage(e));
    }
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
        <SheetContent
          onEscapeKeyDown={(e) => {
            if (formState.isDirty) {
              e.preventDefault();
              setConfirmDiscard(true);
            }
          }}
          onInteractOutside={(e) => {
            if (formState.isDirty) {
              e.preventDefault();
              setConfirmDiscard(true);
            }
          }}
        >
          <form onSubmit={onSubmit} className="flex h-full flex-col" noValidate>
            <div className="border-border border-b px-6 pt-5 pr-12 pb-4">
              <DialogTitle className="text-base font-semibold">
                {lead ? `Edit ${lead.code}` : "New lead"}
              </DialogTitle>
              <DialogDescription className="text-fg-muted mt-0.5 text-[13px]">
                {lead
                  ? "Changes are recorded in the lead's activity history."
                  : "Capture who they are, what they need and who owns the next step."}
              </DialogDescription>
            </div>

            <div className="flex-1 scrollbar-thin space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Contact
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Contact name" htmlFor="name" required error={errors.name?.message}>
                    <Input id="name" autoFocus {...register("name")} aria-invalid={!!errors.name} />
                  </Field>
                  <Field label="Company" htmlFor="company" error={errors.company?.message}>
                    <Input id="company" {...register("company")} />
                  </Field>
                  <Field label="Phone" htmlFor="phone" required error={errors.phone?.message}>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="+91 98765 43210"
                      {...register("phone")}
                      aria-invalid={!!errors.phone}
                    />
                  </Field>
                  <Field label="Email" htmlFor="email" error={errors.email?.message}>
                    <Input
                      id="email"
                      type="email"
                      {...register("email")}
                      aria-invalid={!!errors.email}
                    />
                  </Field>
                  <Field label="City" htmlFor="city">
                    <Input id="city" placeholder="Bikaner" {...register("city")} />
                  </Field>
                </div>
                {dupes && (
                  <div
                    role="status"
                    className={cn(
                      "rounded-lg border p-3 text-[13px]",
                      dupAck
                        ? "border-warning bg-warning-soft"
                        : "border-warning/50 bg-warning-soft/60",
                    )}
                  >
                    <p className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="text-warning size-4" /> Possible duplicate
                    </p>
                    <ul className="mt-2 space-y-1">
                      {dupes.matches.map((m) => (
                        <li key={m.lead.id} className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/leads/${m.lead.id}`}
                            target="_blank"
                            className="text-accent font-medium hover:underline"
                          >
                            {m.lead.code} · {m.lead.company ?? m.lead.name}
                          </Link>
                          <StageBadge stage={m.lead.stage} />
                          <span className="text-fg-muted text-xs">
                            matched on {m.matchedOn.join(", ")}
                          </span>
                        </li>
                      ))}
                      {dupes.hiddenMatchCount > 0 && (
                        <li className="text-fg-muted text-xs">
                          {dupes.hiddenMatchCount} matching lead
                          {dupes.hiddenMatchCount > 1 ? "s are" : " is"} owned by another team.
                          Check with your manager before creating.
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Opportunity
                </h3>
                <Field
                  label="Products / services of interest"
                  htmlFor="productInterest"
                  required
                  error={errors.productInterest?.message}
                >
                  <Controller
                    control={control}
                    name="productInterest"
                    render={({ field }) => (
                      <div
                        id="productInterest"
                        role="group"
                        aria-label="Products of interest"
                        className="flex flex-wrap gap-1.5"
                      >
                        {(Object.keys(PRODUCT_LINES) as ProductLine[]).map((p) => {
                          const on = field.value.includes(p);
                          return (
                            <button
                              key={p}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                field.onChange(
                                  on ? field.value.filter((x) => x !== p) : [...field.value, p],
                                )
                              }
                              onBlur={field.onBlur}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                                on
                                  ? "border-accent bg-accent-soft text-accent-soft-fg"
                                  : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                              )}
                            >
                              {on && <Check className="size-3" />}
                              {PRODUCT_LINES[p]}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Estimated value (₹)"
                    htmlFor="estimatedValue"
                    required
                    error={errors.estimatedValue?.message}
                    hint="Before GST"
                  >
                    <Input
                      id="estimatedValue"
                      inputMode="decimal"
                      placeholder="150000"
                      {...register("estimatedValue")}
                      aria-invalid={!!errors.estimatedValue}
                    />
                  </Field>
                  <Field label="Priority" htmlFor="priority">
                    <Controller
                      control={control}
                      name="priority"
                      render={({ field }) => (
                        <Segmented<Priority>
                          label="Priority"
                          value={field.value}
                          onChange={field.onChange}
                          options={[
                            { value: "low", label: "Low" },
                            { value: "medium", label: "Medium" },
                            { value: "high", label: "High" },
                          ]}
                        />
                      )}
                    />
                  </Field>
                  <Field label="Source" htmlFor="source" required>
                    <Controller
                      control={control}
                      name="source"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="source">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(LEAD_SOURCES).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field label="Campaign" htmlFor="campaign" hint="Optional attribution">
                    <Input id="campaign" placeholder="Diwali POS offer" {...register("campaign")} />
                  </Field>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Ownership & next step
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Owner"
                    htmlFor="ownerId"
                    required
                    error={errors.ownerId?.message}
                    hint={canAssign ? undefined : "You can only own leads you create."}
                  >
                    <Controller
                      control={control}
                      name="ownerId"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={!canAssign}
                        >
                          <SelectTrigger id="ownerId">
                            <SelectValue placeholder="Choose owner" />
                          </SelectTrigger>
                          <SelectContent>
                            {ownerOptions.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name} · {u.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field label="Next follow-up" htmlFor="nextFollowUpAt">
                    <Controller
                      control={control}
                      name="nextFollowUpAt"
                      render={({ field }) => (
                        <Input
                          id="nextFollowUpAt"
                          type="datetime-local"
                          value={toLocalInput(field.value)}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value ? new Date(e.target.value).toISOString() : null,
                            )
                          }
                          onBlur={field.onBlur}
                        />
                      )}
                    />
                  </Field>
                </div>
                <Field label="Notes" htmlFor="notes">
                  <Textarea
                    id="notes"
                    rows={3}
                    placeholder="Context the next person should know"
                    {...register("notes")}
                  />
                </Field>
              </section>
            </div>

            <div className="border-border bg-surface-2/60 flex items-center justify-between gap-2 border-t px-6 py-3">
              <p className="text-fg-subtle text-xs">
                {formState.isDirty ? "Unsaved changes" : " "}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={pending}
                  disabled={!!lead && !formState.isDirty}
                >
                  {lead ? "Save changes" : dupes && dupAck ? "Create anyway" : "Create lead"}
                </Button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description={`Your changes to ${getValues("name") || "this lead"} haven't been saved.`}
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
