"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Sheet = { kind: "lead"; leadId?: string } | { kind: "client"; clientId?: string } | null;

interface GlobalUi {
  sheet: Sheet;
  openSheet(sheet: NonNullable<Sheet>): void;
  closeSheet(): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
}

const Ctx = createContext<GlobalUi | null>(null);

export function GlobalUiProvider({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openSheet = useCallback((s: NonNullable<Sheet>) => setSheet(s), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  return (
    <Ctx.Provider value={{ sheet, openSheet, closeSheet, paletteOpen, setPaletteOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGlobalUi(): GlobalUi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGlobalUi must be used inside GlobalUiProvider");
  return ctx;
}
