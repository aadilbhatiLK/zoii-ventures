import { describe, expect, it } from "vitest";
import { createDemoAuthAdapter } from "@/lib/auth/demo-auth";
import { DEMO_OTP, DEMO_PASSWORD } from "@/lib/mock/seed";
import { ApiError } from "@/lib/api/errors";

const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof ApiError ? e.code : "THROWN"),
  );

describe("demo auth mimics production auth behaviour", () => {
  it("signs in a non-privileged user and returns a session", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const r = await auth.signInWithPassword("neha@demo.zoii.in", DEMO_PASSWORD);
    expect(r.status).toBe("ok");
    expect((await auth.getSession())?.user.id).toBe("u_sales1");
  });

  it("requires MFA for privileged roles", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const r = await auth.signInWithPassword("founder@demo.zoii.in", DEMO_PASSWORD);
    expect(r.status).toBe("mfa_required");
    expect(await auth.getSession()).toBeNull();
    if (r.status !== "mfa_required") return;
    const s = await auth.verifyMfa(r.challengeId, DEMO_OTP);
    expect(s.mfaSatisfied).toBe(true);
  });

  it("OTP codes are single-use", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const c = await auth.requestPhoneOtp("90000 00004");
    await auth.verifyPhoneOtp(c.challengeId, DEMO_OTP);
    expect(await codeOf(auth.verifyPhoneOtp(c.challengeId, DEMO_OTP))).toBe("UNAUTHENTICATED");
  });

  it("OTP codes expire after 5 minutes", async () => {
    let t = 1_000_000;
    const auth = createDemoAuthAdapter({ storage: null, now: () => t });
    const c = await auth.requestPhoneOtp("9000000004");
    t += 5 * 60_000 + 1;
    expect(await codeOf(auth.verifyPhoneOtp(c.challengeId, DEMO_OTP))).toBe("UNAUTHENTICATED");
  });

  it("unknown numbers never verify, and the response doesn't reveal that", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    const c = await auth.requestPhoneOtp("9999999999");
    expect(c.challengeId).toBeTruthy();
    expect(await codeOf(auth.verifyPhoneOtp(c.challengeId, DEMO_OTP))).toBe("UNAUTHENTICATED");
  });

  it("rate-limits repeated failures", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    for (let i = 0; i < 5; i++)
      expect(await codeOf(auth.signInWithPassword("neha@demo.zoii.in", "wrong"))).toBe(
        "UNAUTHENTICATED",
      );
    expect(await codeOf(auth.signInWithPassword("neha@demo.zoii.in", DEMO_PASSWORD))).toBe(
      "RATE_LIMITED",
    );
  });

  it("expires sessions", async () => {
    let t = Date.parse("2026-10-25T09:00:00Z");
    const auth = createDemoAuthAdapter({ storage: null, now: () => t });
    await auth.signInWithPassword("neha@demo.zoii.in", DEMO_PASSWORD);
    t += 8 * 3_600_000 + 1;
    expect(await auth.getSession()).toBeNull();
  });

  it("password reset never reveals whether an account exists", async () => {
    const auth = createDemoAuthAdapter({ storage: null });
    await expect(auth.requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
    await expect(auth.requestPasswordReset("neha@demo.zoii.in")).resolves.toBeUndefined();
  });
});
