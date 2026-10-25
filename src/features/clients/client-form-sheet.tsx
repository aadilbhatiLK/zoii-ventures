"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import {
  CLIENT_CATEGORIES,
  ClientInputSchema,
  PRODUCT_LINES,
  type Client,
  type ClientInput,
  type ClientInputParsed,
  type ProductLine,
} from "@/lib/api/contracts";
import { isApiError, userMessage } from "@/lib/api/errors";
import { validateGstin } from "@/lib/validation/gstin";
import { useUserDirectory } from "@/features/leads/hooks";
import { useClient, useSaveClient } from "./hooks";
import { cn } from "@/lib/utils";

function defaults(c?: Client): ClientInput {
  const primary = c?.contacts.find((x) => x.isPrimary) ?? c?.contacts[0];
  return {
    name: c?.name ?? "",
    legalName: c?.legalName ?? "",
    industry: c?.industry ?? "",
    category: c?.category ?? "smb",
    status: c?.status ?? "onboarding",
    accountManagerId: c?.accountManagerId ?? "",
    gstin: c?.gstin ?? "",
    website: c?.website ?? "",
    billingAddress: {
      line1: c?.billingAddress.line1 === "To be confirmed" ? "" : (c?.billingAddress.line1 ?? ""),
      line2: c?.billingAddress.line2 ?? "",
      city: c?.billingAddress.city ?? "",
      state: c?.billingAddress.state ?? "",
      pincode: c?.billingAddress.pincode ?? "",
    },
    productLines: c?.productLines ?? [],
    primaryContact: {
      name: primary?.name ?? "",
      designation: primary?.designation ?? "",
      email: primary?.email ?? "",
      phone: primary?.phone ?? "",
    },
  };
}

export function ClientFormSheet({
  clientId,
  open,
  onClose,
}: {
  clientId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const client = useClient(clientId ?? "");
  if (clientId && !client.data) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Loading client</DialogTitle>
          <div className="space-y-4 p-6">
            {client.isError ? (
              <p className="text-danger text-sm">{userMessage(client.error)}</p>
            ) : (
              <>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </>
            )}
          </div>
        </SheetContent>
      </Dialog>
    );
  }
  return <ClientForm key={clientId ?? "new"} client={client.data} open={open} onClose={onClose} />;
}

function ClientForm({
  client,
  open,
  onClose,
}: {
  client?: Client;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const save = useSaveClient(client?.id);
  const directory = useUserDirectory();
  const managers = (directory.data ?? []).filter((u) =>
    u.roles.some((r) => r === "account_manager" || r === "sales_manager" || r === "founder"),
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useForm<ClientInput, unknown, ClientInputParsed>({
    resolver: zodResolver(ClientInputSchema),
    defaultValues: defaults(client),
    mode: "onTouched",
  });
  const { register, control, handleSubmit, formState, setError, setValue } = form;
  const e = formState.errors;
  const gstin = useWatch({ control, name: "gstin" });
  const gstCheck = gstin && gstin.length === 15 ? validateGstin(gstin) : null;

  const requestClose = () => (formState.isDirty ? setConfirmDiscard(true) : onClose());
  const guard = (ev: Event) => {
    if (formState.isDirty) {
      ev.preventDefault();
      setConfirmDiscard(true);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(values);
      if (client) toast.success("Client updated");
      else
        toast.success(`Client ${saved.code} created`, {
          action: { label: "Open", onClick: () => router.push(`/clients/${saved.id}`) },
        });
      onClose();
    } catch (err) {
      if (isApiError(err) && err.details)
        for (const [k, m] of Object.entries(err.details))
          setError(k as keyof ClientInput, { message: m[0] });
      toast.error(userMessage(err));
    }
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
        <SheetContent onEscapeKeyDown={guard} onInteractOutside={guard}>
          <form onSubmit={onSubmit} className="flex h-full flex-col" noValidate>
            <div className="border-border border-b px-6 pt-5 pr-12 pb-4">
              <DialogTitle className="text-base font-semibold">
                {client ? `Edit ${client.code}` : "New client"}
              </DialogTitle>
              <DialogDescription className="text-fg-muted mt-0.5 text-[13px]">
                Legal and tax details drive invoices later, so match the GST registration.
              </DialogDescription>
            </div>
            <div className="flex-1 scrollbar-thin space-y-6 overflow-y-auto px-6 py-5">
              <section className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name" htmlFor="c-name" required error={e.name?.message}>
                  <Input id="c-name" autoFocus {...register("name")} aria-invalid={!!e.name} />
                </Field>
                <Field label="Legal name" htmlFor="c-legal" required error={e.legalName?.message}>
                  <Input id="c-legal" {...register("legalName")} aria-invalid={!!e.legalName} />
                </Field>
                <Field label="Industry" htmlFor="c-industry" required error={e.industry?.message}>
                  <Input
                    id="c-industry"
                    placeholder="Jewellery"
                    {...register("industry")}
                    aria-invalid={!!e.industry}
                  />
                </Field>
                <Field label="Category" htmlFor="c-cat">
                  <Controller
                    control={control}
                    name="category"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="c-cat">
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
                    )}
                  />
                </Field>
                <Field label="Status" htmlFor="c-status">
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="c-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="onboarding">Onboarding</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field
                  label="Account manager"
                  htmlFor="c-am"
                  required
                  error={e.accountManagerId?.message}
                >
                  <Controller
                    control={control}
                    name="accountManagerId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="c-am">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {managers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </section>

              <section className="space-y-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Tax & billing
                </h3>
                <Field
                  label="GSTIN"
                  htmlFor="c-gstin"
                  error={e.gstin?.message}
                  hint="Leave blank for unregistered clients. Checked for format, state code and checksum."
                >
                  <div className="relative">
                    <Input
                      id="c-gstin"
                      className="pr-28 font-mono uppercase"
                      maxLength={15}
                      placeholder="08ABCDE1234F1Z5"
                      {...register("gstin", {
                        onChange: (ev: React.ChangeEvent<HTMLInputElement>) => {
                          const check =
                            ev.target.value.length === 15 ? validateGstin(ev.target.value) : null;
                          if (check?.valid)
                            setValue("billingAddress.state", check.stateName, {
                              shouldDirty: true,
                            });
                        },
                      })}
                      aria-invalid={!!e.gstin}
                    />
                    {gstCheck?.valid && (
                      <span className="text-success absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 text-xs font-medium">
                        <BadgeCheck className="size-3.5" />
                        {gstCheck.stateName}
                      </span>
                    )}
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Address line 1"
                    htmlFor="c-a1"
                    required
                    error={e.billingAddress?.line1?.message}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="c-a1"
                      {...register("billingAddress.line1")}
                      aria-invalid={!!e.billingAddress?.line1}
                    />
                  </Field>
                  <Field label="Address line 2" htmlFor="c-a2" className="sm:col-span-2">
                    <Input id="c-a2" {...register("billingAddress.line2")} />
                  </Field>
                  <Field
                    label="City"
                    htmlFor="c-city"
                    required
                    error={e.billingAddress?.city?.message}
                  >
                    <Input
                      id="c-city"
                      {...register("billingAddress.city")}
                      aria-invalid={!!e.billingAddress?.city}
                    />
                  </Field>
                  <Field
                    label="State"
                    htmlFor="c-state"
                    required
                    error={e.billingAddress?.state?.message}
                    hint="Decides CGST+SGST vs IGST on invoices"
                  >
                    <Input
                      id="c-state"
                      {...register("billingAddress.state")}
                      aria-invalid={!!e.billingAddress?.state}
                    />
                  </Field>
                  <Field
                    label="PIN code"
                    htmlFor="c-pin"
                    required
                    error={e.billingAddress?.pincode?.message}
                  >
                    <Input
                      id="c-pin"
                      inputMode="numeric"
                      maxLength={6}
                      {...register("billingAddress.pincode")}
                      aria-invalid={!!e.billingAddress?.pincode}
                    />
                  </Field>
                  <Field label="Website" htmlFor="c-web">
                    <Input id="c-web" placeholder="https://" {...register("website")} />
                  </Field>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Primary contact
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Name"
                    htmlFor="c-pc-name"
                    required
                    error={e.primaryContact?.name?.message}
                  >
                    <Input
                      id="c-pc-name"
                      {...register("primaryContact.name")}
                      aria-invalid={!!e.primaryContact?.name}
                    />
                  </Field>
                  <Field label="Designation" htmlFor="c-pc-desig">
                    <Input
                      id="c-pc-desig"
                      placeholder="Owner"
                      {...register("primaryContact.designation")}
                    />
                  </Field>
                  <Field
                    label="Phone"
                    htmlFor="c-pc-phone"
                    required
                    error={e.primaryContact?.phone?.message}
                  >
                    <Input
                      id="c-pc-phone"
                      type="tel"
                      {...register("primaryContact.phone")}
                      aria-invalid={!!e.primaryContact?.phone}
                    />
                  </Field>
                  <Field
                    label="Email"
                    htmlFor="c-pc-email"
                    error={e.primaryContact?.email?.message}
                  >
                    <Input
                      id="c-pc-email"
                      type="email"
                      {...register("primaryContact.email")}
                      aria-invalid={!!e.primaryContact?.email}
                    />
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
                  Products & services in use
                </h3>
                <Controller
                  control={control}
                  name="productLines"
                  render={({ field }) => (
                    <div
                      role="group"
                      aria-label="Products in use"
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
                            className={cn(
                              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                              on
                                ? "border-accent bg-accent-soft text-accent-soft-fg"
                                : "border-border text-fg-muted hover:text-fg",
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
              </section>
            </div>
            <div className="border-border bg-surface-2/60 flex items-center justify-between gap-2 border-t px-6 py-3">
              <p className="text-fg-subtle text-xs">
                {formState.isDirty ? "Unsaved changes" : " "}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={requestClose}
                  disabled={save.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={save.isPending}
                  disabled={!!client && !formState.isDirty}
                >
                  {client ? "Save changes" : "Create client"}
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
        description="Your changes to this client haven't been saved."
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
