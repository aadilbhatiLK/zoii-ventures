"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { apiBase, apiFetch } from "@/lib/api/request";
import { errorText } from "@/lib/api/hooks";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!apiBase()) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="text-fg-muted mt-2 text-sm">Password reset links work when the app is connected to the backend. Demo accounts use the password shown on the sign-in page.</p>
        <Button asChild className="mt-6" variant="primary"><Link href="/login">Back to sign in</Link></Button>
      </div>
    );
  }
  if (done) {
    return (
      <div className="animate-fade-in">
        <div className="bg-success-soft text-success mb-6 flex size-10 items-center justify-center rounded-lg"><CheckCircle2 className="size-5" /></div>
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p className="text-fg-muted mt-1 text-sm">All your other sessions were signed out. Sign in with the new password.</p>
        <Button asChild className="mt-6 w-full" variant="primary" size="lg"><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }
  return (
    <div className="animate-fade-in">
      <div className="bg-accent-soft text-accent mb-6 flex size-10 items-center justify-center rounded-lg"><KeyRound className="size-5" /></div>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <p className="text-fg-muted mt-1 text-sm">At least 10 characters. Avoid your name or email.</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setError("The passwords don't match.");
          if (!token) return setError("This link is missing its token. Request a new one.");
          setBusy(true);
          setError(null);
          try {
            await apiFetch("POST", "/auth/password/reset", { token, password: pw });
            setDone(true);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="New password" htmlFor="pw" required>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Field label="Repeat password" htmlFor="pw2" required error={error ?? undefined}>
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={pw.length < 10}>Update password</Button>
      </form>
    </div>
  );
}
