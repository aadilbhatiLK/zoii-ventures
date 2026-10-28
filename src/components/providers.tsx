"use client";

import { useState } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";
import { AuthProvider } from "@/features/auth/auth-provider";
import { ThemeProvider, useTheme } from "@/components/theme";
import { isApiError } from "@/lib/api/errors";

function makeQueryClient() {
  const onAuthError = (error: unknown) => {
    if (isApiError(error) && error.code === "UNAUTHENTICATED" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zoii:unauthenticated"));
    }
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => {
          if (isApiError(error) && error.status && error.status < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{ className: "!font-sans !text-[13px]" }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </AuthProvider>
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
