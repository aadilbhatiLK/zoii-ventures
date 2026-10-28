"use client";

import { AlertDialog as AD } from "radix-ui";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}

/** Confirmation for bulk and destructive actions. Focus starts on Cancel. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 z-50" />
        <AD.Content className="border-border bg-surface data-[state=open]:animate-scale-in fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-lg">
          <AD.Title className="text-base font-semibold">{title}</AD.Title>
          <AD.Description className="text-fg-muted mt-1.5 text-[13px]">
            {description}
          </AD.Description>
          {children}
          <div className="mt-5 flex justify-end gap-2">
            <AD.Cancel className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Cancel
            </AD.Cancel>
            <AD.Action
              className={cn(
                buttonVariants({ variant: destructive ? "danger" : "primary", size: "sm" }),
              )}
              onClick={onConfirm}
            >
              {confirmLabel}
            </AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
