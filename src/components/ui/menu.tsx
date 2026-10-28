"use client";

import { DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const panel =
  "z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 text-sm shadow-md data-[state=open]:animate-scale-in";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(panel, className)}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  destructive,
  ...props
}: React.ComponentProps<typeof M.Item> & { inset?: boolean; destructive?: boolean }) {
  return (
    <M.Item
      className={cn(
        "data-[highlighted]:bg-surface-3 [&_svg]:text-fg-subtle relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4",
        inset && "pl-8",
        destructive && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem
      className={cn(
        "data-[highlighted]:bg-surface-3 relative flex h-8 cursor-default items-center gap-2 rounded-md pr-2 pl-8 text-[13px] outline-none select-none",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <M.ItemIndicator>
          <Check className="size-3.5" />
        </M.ItemIndicator>
      </span>
      {children}
    </M.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return (
    <M.Label
      className={cn(
        "text-2xs text-fg-subtle px-2 py-1.5 font-medium tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn("bg-border -mx-1 my-1 h-px", className)} {...props} />;
}

export const DropdownMenuSub = M.Sub;
export function DropdownMenuSubTrigger({
  className,
  ...props
}: React.ComponentProps<typeof M.SubTrigger>) {
  return (
    <M.SubTrigger
      className={cn(
        "data-[highlighted]:bg-surface-3 data-[state=open]:bg-surface-3 [&_svg]:text-fg-subtle flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-none [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent className={cn(panel, "max-h-80 overflow-y-auto", className)} {...props} />
    </M.Portal>
  );
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export function PopoverContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(panel, "p-0", className)}
        {...props}
      />
    </P.Portal>
  );
}

export const TooltipProvider = T.Provider;
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="bg-fg text-bg data-[state=delayed-open]:animate-fade-in z-50 rounded-md px-2 py-1 text-xs shadow-md"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
