"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 z-50 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "border-border bg-surface data-[state=open]:animate-scale-in fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border shadow-lg outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="text-fg-subtle hover:bg-surface-3 hover:text-fg absolute top-3.5 right-3.5 rounded-md p-1"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border flex flex-col gap-1 border-b px-5 pt-5 pr-12 pb-4", className)}
      {...props}
    />
  );
}
export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("scrollbar-thin overflow-y-auto px-5 py-4", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-border bg-surface-2/60 flex items-center justify-end gap-2 rounded-b-xl border-t px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-base font-semibold", className)} {...props} />;
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-fg-muted text-[13px]", className)} {...props} />;
}

/** Right-hand drawer for create/edit flows and quick previews. */
export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: "right" | "left" }) {
  return (
    <D.Portal>
      <D.Overlay className="bg-overlay data-[state=open]:animate-fade-in fixed inset-0 z-50" />
      <D.Content
        className={cn(
          "border-border bg-surface fixed inset-y-0 z-50 flex w-full flex-col shadow-lg outline-none",
          side === "right"
            ? "data-[state=open]:animate-slide-in-right right-0 border-l sm:max-w-xl"
            : "data-[state=open]:animate-slide-in-left left-0 border-r sm:max-w-xs",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="text-fg-subtle hover:bg-surface-3 hover:text-fg absolute top-4 right-4 rounded-md p-1"
          aria-label="Close"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
