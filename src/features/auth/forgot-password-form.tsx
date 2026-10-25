"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAuth } from "./auth-provider";
import { userMessage } from "@/lib/api/errors";

export function ForgotPasswordForm() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="animate-fade-in">
        <div className="bg-success-soft text-success mb-6 flex size-10 items-center justify-center rounded-lg">
          <MailCheck className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-fg-muted mt-2 text-sm">
          If an account exists for <span className="text-fg font-medium">{email}</span>, we&apos;ve
          sent a link to reset the password. The link expires in 30 minutes.
        </p>
        <Button asChild variant="secondary" className="mt-6 w-full" size="lg">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <Link
        href="/login"
        className="text-fg-muted hover:text-fg mb-6 inline-flex items-center gap-1 text-[13px]"
      >
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-fg-muted mt-1 text-sm">
        Enter your work email and we&apos;ll send a reset link.
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
          setBusy(true);
          setError(null);
          try {
            await auth.requestPasswordReset(email);
            setSent(true);
          } catch (err) {
            setError(userMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        noValidate
      >
        <Field label="Work email" htmlFor="reset-email" error={error ?? undefined}>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            aria-invalid={!!error}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
    </div>
  );
}
