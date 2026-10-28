"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV, findNavItem } from "@/lib/nav";

const Ctx = createContext<{ label: string | null; setLabel: (l: string | null) => void }>({
  label: null,
  setLabel: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <Ctx.Provider value={{ label, setLabel }}>{children}</Ctx.Provider>;
}

/** A detail page calls this to show the record name as the last crumb. */
export function useRecordBreadcrumb(label: string | null | undefined) {
  const { setLabel } = useContext(Ctx);
  useEffect(() => {
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { label } = useContext(Ctx);
  const item = findNavItem(pathname);
  const group = item ? NAV.find((g) => g.items.includes(item)) : undefined;
  const isDetail = item && pathname !== item.href;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
      {group && <span className="text-fg-subtle hidden sm:inline">{group.title}</span>}
      {group && (
        <ChevronRight className="text-fg-subtle hidden size-3.5 shrink-0 sm:inline" aria-hidden />
      )}
      {item &&
        (isDetail ? (
          <Link href={item.href} className="text-fg-muted hover:text-fg truncate">
            {item.title}
          </Link>
        ) : (
          <span className="text-fg truncate font-medium" aria-current="page">
            {item.title}
          </span>
        ))}
      {isDetail && (
        <>
          <ChevronRight className="text-fg-subtle size-3.5 shrink-0" aria-hidden />
          <span className="text-fg truncate font-medium" aria-current="page">
            {label ?? "…"}
          </span>
        </>
      )}
    </nav>
  );
}
