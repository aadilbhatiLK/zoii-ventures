"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { EmptyState } from "@/components/feedback/states";
import { ModulePage, Money, NativeSelect, Section, SimpleTable, StatusBadge, Tag } from "@/components/module/kit";
import { useAuth } from "@/features/auth/auth-provider";
import { useApi, useApiMutation } from "@/lib/api/hooks";
import { PRODUCT_LINES } from "@/lib/api/contracts";
import { BILLING_CYCLES } from "@/lib/api/modules/common";
import { ProductInputSchema, TaxRuleInputSchema, type Product, type ProductInput, type TaxRule } from "@/lib/api/modules/sales";
import { formatDate } from "@/lib/formatting";
import type { z } from "zod";

export function CatalogueView() {
  const { can } = useAuth();
  const [tab, setTab] = useState("products");
  const products = useApi<Product[]>(["products", "all"], "/products?active=all");
  const rules = useApi<TaxRule[]>(["tax-rules"], "/tax-rules");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  return (
    <ModulePage title="Product Catalogue" description="Products and plans with HSN/SAC codes. Quotations and invoices take their GST rate from Tax rules on the document date."
      permissions={["catalogue.view", "catalogue.manage", "quotations.create"]}
      actions={can("catalogue.manage") && tab === "products" ? <Button variant="primary" size="sm" onClick={() => setEditing("new")}><Plus /> New product</Button>
        : can("tax.manage") && tab === "tax" ? <Button variant="primary" size="sm" onClick={() => setRuleOpen(true)}><Plus /> New rate version</Button> : null}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="products">Products</TabsTrigger><TabsTrigger value="tax">Tax rules</TabsTrigger></TabsList>
        <TabsContent value="products" className="pt-4">
          <Section flush>
            <SimpleTable label="Products" rows={products.data} rowKey={(p) => p.id} loading={products.isLoading} error={products.error}
              onRowClick={can("catalogue.manage") ? (p) => setEditing(p) : undefined}
              empty={<EmptyState title="No products yet" description="Add the services you sell so quotations can be priced consistently." />}
              columns={[
                { key: "n", header: "Product", cell: (p) => <div><div className="font-medium">{p.name}</div><div className="text-fg-subtle text-xs">{p.code} · {PRODUCT_LINES[p.productLine as keyof typeof PRODUCT_LINES]}</div></div> },
                { key: "c", header: "Billing", cell: (p) => BILLING_CYCLES[p.billingCycle], hideBelow: "md" },
                { key: "h", header: "HSN/SAC", cell: (p) => <span className="font-mono text-xs">{p.hsnSac}</span>, hideBelow: "sm" },
                { key: "g", header: "GST today", cell: (p) => (p.taxRate ? `${Number(p.taxRate)}%` : <Tag tone="danger">No rule</Tag>), hideBelow: "sm" },
                { key: "p", header: "List price", align: "right", cell: (p) => <Money value={p.unitPrice} /> },
                { key: "f", header: "Floor", align: "right", cell: (p) => <Money value={p.floorPrice} muted />, hideBelow: "lg" },
                { key: "s", header: "", cell: (p) => !p.active && <StatusBadge status="cancelled" label="Inactive" /> },
              ]} />
          </Section>
        </TabsContent>
        <TabsContent value="tax" className="pt-4">
          <Section flush description="Each HSN/SAC has dated versions. A new version closes the previous one the day before it starts. Confirm rates with your CA — goods rates aren't pre-filled.">
            <SimpleTable label="Tax rules" rows={rules.data} rowKey={(r) => r.id} loading={rules.isLoading} error={rules.error}
              columns={[
                { key: "h", header: "HSN/SAC", cell: (r) => <span className="font-mono">{r.hsnSac}</span> },
                { key: "d", header: "Description", cell: (r) => r.description },
                { key: "r", header: "Rate", align: "right", cell: (r) => `${Number(r.rate)}%` },
                { key: "f", header: "From", cell: (r) => formatDate(r.effectiveFrom) },
                { key: "t", header: "To", cell: (r) => (r.effectiveTo ? formatDate(r.effectiveTo) : <Tag tone="success">Current</Tag>) },
              ]} />
          </Section>
        </TabsContent>
      </Tabs>
      {editing && <ProductDialog product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {ruleOpen && <TaxRuleDialog onClose={() => setRuleOpen(false)} />}
    </ModulePage>
  );
}

function ProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const f = useForm<ProductInput>({
    resolver: zodResolver(ProductInputSchema) as never,
    defaultValues: product
      ? { code: product.code, name: product.name, description: product.description ?? "", productLine: product.productLine as ProductInput["productLine"], kind: product.kind, billingCycle: product.billingCycle, unit: product.unit, hsnSac: product.hsnSac, unitPrice: product.unitPrice, floorPrice: product.floorPrice ?? "", active: product.active }
      : { kind: "service", billingCycle: "one_time", unit: "unit", productLine: "custom_software", hsnSac: "998314", active: true, unitPrice: "", code: "", name: "" },
  });
  const save = useApiMutation<ProductInput, Product>(product ? "PUT" : "POST", product ? `/products/${product.id}` : "/products", { invalidate: [["products"]], success: product ? "Product updated" : "Product added" });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={f.handleSubmit((v) => save.mutate({ ...v, floorPrice: v.floorPrice || null }, { onSuccess: onClose }))} noValidate>
          <DialogHeader><DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" htmlFor="code" required error={e.code?.message}><Input id="code" {...f.register("code")} placeholder="WEB-BASIC" /></Field>
            <Field label="Name" htmlFor="name" required error={e.name?.message}><Input id="name" {...f.register("name")} /></Field>
            <Field label="Product line" htmlFor="pl" required><NativeSelect id="pl" {...f.register("productLine")}>{Object.entries(PRODUCT_LINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
            <Field label="Kind" htmlFor="kind" required><NativeSelect id="kind" {...f.register("kind")}><option value="service">Service</option><option value="one_time">One-time product</option><option value="recurring">Recurring (subscription)</option></NativeSelect></Field>
            <Field label="Billing cycle" htmlFor="bc" error={e.billingCycle?.message}><NativeSelect id="bc" {...f.register("billingCycle")}>{Object.entries(BILLING_CYCLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
            <Field label="HSN / SAC" htmlFor="hsn" required error={e.hsnSac?.message} hint="Services: 998314 development, 998313 consulting, 998361 advertising"><Input id="hsn" inputMode="numeric" {...f.register("hsnSac")} /></Field>
            <Field label="List price (₹, before GST)" htmlFor="up" required error={e.unitPrice?.message}><Input id="up" inputMode="decimal" {...f.register("unitPrice")} /></Field>
            <Field label="Floor price" htmlFor="fp" error={e.floorPrice?.message} hint="Quotes below this need approval"><Input id="fp" inputMode="decimal" {...f.register("floorPrice")} /></Field>
            <Field label="Description" htmlFor="desc" className="sm:col-span-2"><Textarea id="desc" {...f.register("description")} /></Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" {...f.register("active")} /> Active (available on new quotations)</label>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaxRuleDialog({ onClose }: { onClose: () => void }) {
  type V = z.input<typeof TaxRuleInputSchema>;
  const f = useForm<V>({ resolver: zodResolver(TaxRuleInputSchema) as never, defaultValues: { hsnSac: "", description: "", rate: "18", effectiveFrom: "" } });
  const save = useApiMutation<V>("POST", "/tax-rules", { invalidate: [["tax-rules"], ["products"]], success: "Rate version added" });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={f.handleSubmit((v) => save.mutate(v, { onSuccess: onClose }))} noValidate>
          <DialogHeader><DialogTitle>New GST rate version</DialogTitle></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="HSN / SAC" htmlFor="h" required error={e.hsnSac?.message}><Input id="h" {...f.register("hsnSac")} /></Field>
            <Field label="Rate %" htmlFor="r" required error={e.rate?.message}><Input id="r" inputMode="decimal" {...f.register("rate")} /></Field>
            <Field label="Description" htmlFor="d" required error={e.description?.message} className="sm:col-span-2"><Input id="d" {...f.register("description")} /></Field>
            <Field label="Effective from" htmlFor="ef" required error={e.effectiveFrom?.message} hint="Documents dated on or after this use the new rate"><Input id="ef" type="date" {...f.register("effectiveFrom")} /></Field>
          </DialogBody>
          <DialogFooter><Button type="button" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" variant="primary" loading={save.isPending}>Add version</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
