"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { useAuth } from "./auth-provider";
import { safeNextPath } from "./safe-next";
import { isApiError, userMessage } from "@/lib/api/errors";
import { DEMO_OTP, DEMO_PASSWORD } from "@/lib/mock/seed";
import { appConfig } from "@/lib/config/env";
import { cn } from "@/lib/utils";

const isDemo = appConfig.ok && appConfig.mode === "demo";

function CodeInput({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="h-11 text-center font-mono text-lg tracking-[0.5em]"
      placeholder="••••••"
      aria-describedby={`${id}-hint`}
    />
  );
}

export function LoginForm() {
  const router = useRouter();
  const auth = useAuth();
  const [tab, setTab] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<{
    id: string;
    expiresAt: string;
    demoCode?: string;
  } | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (auth.status === "authenticated") {
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [auth.status, router]);

  useEffect(() => {
    if (auth.lastSignOutReason === "expired")
      toast.info("Your session expired. Please sign in again.");
  }, [auth.lastSignOutReason]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // On the sign-in screen an auth failure means bad credentials/code, not an expired session.
      setError(isApiError(e) && e.code === "UNAUTHENTICATED" ? e.message : userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password.");
    void run(async () => {
      const r = await auth.signInWithPassword(email, password);
      if (r.status === "mfa_required") {
        setMfaChallenge(r.challengeId);
        setCode("");
      }
    });
  };

  const sendOtp = () => {
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Enter a 10-digit mobile number.");
      return Promise.resolve();
    }
    return run(async () => {
      const c = await auth.requestPhoneOtp(phone);
      setOtpChallenge({ id: c.challengeId, expiresAt: c.expiresAt, demoCode: c.demoCode });
      setCode("");
      setResendIn(30);
    });
  };

  if (mfaChallenge) {
    return (
      <div className="animate-fade-in">
        <button
          type="button"
          onClick={() => setMfaChallenge(null)}
          className="text-fg-muted hover:text-fg mb-6 inline-flex items-center gap-1 text-[13px]"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="bg-accent-soft text-accent mb-6 flex size-10 items-center justify-center rounded-lg">
          <KeyRound className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">Two-step verification</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Your role requires a second factor. Enter the 6-digit code from your authenticator app.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => auth.verifyMfa(mfaChallenge, code));
          }}
        >
          <Field
            label="Verification code"
            htmlFor="mfa"
            error={error ?? undefined}
            hint={isDemo ? `Demo code: ${DEMO_OTP}` : undefined}
          >
            <CodeInput id="mfa" value={code} onChange={setCode} autoFocus />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={busy}
            disabled={code.length !== 6}
          >
            Verify and continue
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-fg-muted mt-1 text-sm">
        Welcome back. Use your work email or mobile number.
      </p>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as "email" | "phone");
          setError(null);
        }}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="email">
            <Mail /> Email
          </TabsTrigger>
          <TabsTrigger value="phone">
            <Smartphone /> Mobile OTP
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="pt-5">
          <form className="space-y-4" onSubmit={submitPassword} noValidate>
            <Field label="Work email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@zoii.in"
                autoFocus
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-[13px] font-medium">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-accent text-xs font-medium hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="text-fg-subtle hover:text-fg absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]"
              >
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="phone" className="pt-5">
          {!otpChallenge ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void sendOtp();
              }}
            >
              <Field
                label="Mobile number"
                htmlFor="phone"
                hint="We'll send a one-time code by SMS."
              >
                <div className="flex">
                  <span className="border-border bg-surface-2 text-fg-muted inline-flex items-center rounded-l-md border border-r-0 px-3 text-sm">
                    +91
                  </span>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="rounded-l-none"
                    placeholder="98765 43210"
                  />
                </div>
              </Field>
              {error && (
                <p
                  role="alert"
                  className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]"
                >
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
                Send code
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => auth.verifyPhoneOtp(otpChallenge.id, code));
              }}
            >
              <p className="text-fg-muted text-[13px]">
                Code sent to <span className="text-fg font-medium">+91 {phone}</span>.{" "}
                <button
                  type="button"
                  className="text-accent font-medium hover:underline"
                  onClick={() => setOtpChallenge(null)}
                >
                  Change
                </button>
              </p>
              <Field
                label="6-digit code"
                htmlFor="otp"
                error={error ?? undefined}
                hint={
                  otpChallenge.demoCode
                    ? `Demo code: ${otpChallenge.demoCode} (no SMS is sent in demo mode)`
                    : "The code expires in 5 minutes."
                }
              >
                <CodeInput id="otp" value={code} onChange={setCode} autoFocus />
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={busy}
                disabled={code.length !== 6}
              >
                Verify and sign in
              </Button>
              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={() => void sendOtp()}
                className={cn(
                  "w-full text-center text-[13px] font-medium",
                  resendIn > 0 ? "text-fg-subtle" : "text-accent hover:underline",
                )}
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </form>
          )}
        </TabsContent>
      </Tabs>

      {isDemo && (
        <DemoAccounts
          onPick={(e, ph) => {
            setTab("email");
            setEmail(e);
            setPassword(DEMO_PASSWORD);
            setPhone(ph);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

function DemoAccounts({ onPick }: { onPick: (email: string, phone: string) => void }) {
  const { personas } = useAuth();
  if (!personas) return null;
  const featured = ["u_founder", "u_salesmgr", "u_sales1", "u_fin", "u_auditor"];
  return (
    <div className="border-border-strong bg-surface-2 mt-8 rounded-lg border border-dashed p-3">
      <p className="text-fg text-xs font-medium">Demo accounts</p>
      <p className="text-2xs text-fg-muted mt-0.5">
        Password <code className="font-mono">{DEMO_PASSWORD}</code> · OTP/MFA code{" "}
        <code className="font-mono">{DEMO_OTP}</code>. Founder, finance and auditor require MFA.
      </p>
      <div className="mt-2 grid gap-1">
        {personas
          .filter((p) => featured.includes(p.id))
          .map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.email, (p.phone ?? "").replace(/^\+91\s?/, ""))}
              className="hover:bg-surface-3 flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs"
            >
              <span className="font-medium">{p.title}</span>
              <span className="text-fg-subtle">{p.email}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
