"use client";

import { Avatar as A, Checkbox as C, Select as S, Tabs as TB } from "radix-ui";
import { Check, ChevronDown, Minus } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { inputBase } from "./input";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("bg-surface-3 animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <div
      role="separator"
      className={cn(vertical ? "h-full w-px" : "h-px w-full", "bg-border", className)}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "border-border bg-surface-2 text-2xs text-fg-muted inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function UserAvatar({
  name,
  hue,
  size = 24,
  className,
}: {
  name: string;
  hue?: number;
  size?: number;
  className?: string;
}) {
  const h = hue ?? [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return (
    <A.Root
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.4),
        background: `oklch(0.9 0.06 ${h})`,
        color: `oklch(0.38 0.12 ${h})`,
      }}
      title={name}
    >
      <A.Fallback delayMs={0}>{initials(name)}</A.Fallback>
    </A.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "peer border-border-strong bg-surface focus-visible:ring-ring data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </C.Indicator>
    </C.Root>
  );
}

export const Select = S.Root;
export const SelectValue = S.Value;
export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger
      className={cn(
        inputBase,
        "data-[placeholder]:text-fg-subtle flex h-9 items-center justify-between gap-2 text-left",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <S.Icon>
        <ChevronDown className="text-fg-subtle size-4" />
      </S.Icon>
    </S.Trigger>
  );
}
export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content
        position="popper"
        sideOffset={4}
        className={cn(
          "border-border bg-surface data-[state=open]:animate-scale-in z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border shadow-md",
          className,
        )}
        {...props}
      >
        <S.Viewport className="p-1">{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}
export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof S.Item>) {
  return (
    <S.Item
      className={cn(
        "data-[highlighted]:bg-surface-3 relative flex h-8 cursor-default items-center rounded-md pr-2 pl-7 text-[13px] outline-none select-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <S.ItemIndicator>
          <Check className="text-accent size-3.5" />
        </S.ItemIndicator>
      </span>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  );
}

export const Tabs = TB.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TB.List>) {
  return (
    <TB.List
      className={cn("border-border flex items-center gap-1 border-b", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TB.Trigger>) {
  return (
    <TB.Trigger
      className={cn(
        "text-fg-muted hover:text-fg focus-visible:ring-ring data-[state=active]:border-accent data-[state=active]:text-fg relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TB.Content>) {
  return <TB.Content className={cn("outline-none", className)} {...props} />;
}

/** Segmented control for small mutually exclusive choices (e.g. list / board). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="border-border bg-surface-2 inline-flex h-8 items-center rounded-md border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "text-fg-muted focus-visible:ring-ring inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 [&_svg]:size-3.5",
            value === o.value && "bg-surface text-fg shadow-xs",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
