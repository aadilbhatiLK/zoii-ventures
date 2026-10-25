"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only. The worker caches the app shell
 * and an offline page; it never caches API responses or authenticated data.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* PWA is an enhancement; failures are non-fatal */
    });
  }, []);
  return null;
}
