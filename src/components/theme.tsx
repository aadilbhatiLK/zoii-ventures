"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Pref = "light" | "dark" | "system";
const KEY = "zoii.theme";

interface ThemeCtx {
  preference: Pref;
  resolved: "light" | "dark";
  setPreference(p: Pref): void;
}

const Ctx = createContext<ThemeCtx>({
  preference: "system",
  resolved: "light",
  setPreference: () => {},
});

/** Runs before hydration (in <head>) so the first paint uses the right theme. */
export const themeInitScript = `(()=>{try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

function readPref(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Preference is only rendered in client-only menus, so reading storage up front can't cause a hydration mismatch.
  const [preference, setPref] = useState<Pref>(() =>
    typeof window === "undefined" ? "system" : readPref(),
  );
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      setResolved(dark ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference]);

  const setPreference = useCallback((p: Pref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* preference just won't persist */
    }
  }, []);

  return <Ctx.Provider value={{ preference, resolved, setPreference }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
