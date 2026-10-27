import { hash, verify } from "@node-rs/argon2";
import type { Session } from "@/lib/api/contracts";
import { requiresMfa } from "@/lib/permissions";
import type { Queryable } from "../../db";
import type { Deps } from "../../lib/context";
import { decrypt, encrypt, newNumericCode, newToken, matchTotp, newTotpSecret, otpauthUri, safeEqual, sha256 } from "../../lib/crypto";
import { HttpError } from "../../lib/errors";
import { getUserRow, toE164, toUser, type UserRow } from "../users/repo";

const MAX_FAILURES = 5;
const WINDOW_MIN = 10;
const CHALLENGE_MIN = 5;
/** Failure limits per key prefix within WINDOW_MIN; anything else gets MAX_FAILURES. */
const LIMITS: Record<string, number> = { ip: 50, "reset-ip": 20, email: 25, mfa: 10 };
// Verifying against a real hash when the account doesn't exist keeps response time flat.
let dummyHash: Promise<string> | null = null;
const getDummy = () => (dummyHash ??= hash("not-a-real-password-zoii"));

export type SignInResult =
  | { status: "ok"; session: Session; token: string }
  | { status: "mfa_required"; challengeId: string }
  | { status: "mfa_enrollment_required"; challengeId: string; otpauthUri: string; secret: string };

export const hashPassword = (pw: string) => hash(pw);

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Use at most 200 characters.";
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Don't include your email name in the password.";
  if (/^(.)\1+$/.test(pw) || /^(password|zoii|qwerty|123456)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}

export class AuthService {
  constructor(private deps: Deps) {}
  private get db() { return this.deps.db; }
  private now() { return this.deps.now(); }

  /**
   * Per-identifier sliding window of failures. The tight limits are per account *and* client IP,
   * so someone guessing from one address can't lock the real user out from theirs; the looser
   * account-wide limits still stop a distributed attack. IPs get 50 (shared office NAT).
   */
  async throttle(keys: string[], q: Queryable = this.db) {
    const since = new Date(this.now().getTime() - WINDOW_MIN * 60_000);
    const r = await q.query<{ key: string; n: string }>(
      `SELECT key, count(*) AS n FROM auth_attempts WHERE key = ANY($1) AND NOT succeeded AND occurred_at > $2 GROUP BY key`,
      [keys, since],
    );
    for (const row of r.rows) {
      if (Number(row.n) >= (LIMITS[row.key.split(":")[0]] ?? MAX_FAILURES)) throw new HttpError("RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
    }
  }
  async record(key: string, ok: boolean, ip: string | null, q: Queryable = this.db) {
    // Stamped with the app clock, the same clock throttle() measures its window with.
    await q.query(`INSERT INTO auth_attempts (key, succeeded, ip, occurred_at) VALUES ($1, $2, $3, $4)`, [key, ok, ip, this.now()]);
  }

  async createSession(q: Queryable, user: UserRow, mfaSatisfied: boolean, meta: { ip: string | null; userAgent?: string }) {
    const token = newToken();
    const issued = this.now();
    const expires = new Date(issued.getTime() + this.deps.config.sessionHours * 3_600_000);
    await q.query(
      `INSERT INTO sessions (user_id, token_hash, mfa_satisfied, created_at, expires_at, ip, user_agent, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $4)`,
      [user.id, sha256(token), mfaSatisfied, issued, expires, meta.ip, meta.userAgent?.slice(0, 300) ?? null],
    );
    await q.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [user.id, issued]);
    await q.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes, ip)
       VALUES ($1, $2, 'auth.login', 'user', $2, $3, $4)`,
      [user.organization_id, user.id, JSON.stringify({ mfa: mfaSatisfied }), meta.ip],
    );
    const session: Session = { user: toUser(user), issuedAt: issued.toISOString(), expiresAt: expires.toISOString(), mfaSatisfied };
    return { token, session };
  }

  private async newChallenge(userId: string | null, orgId: string | null, kind: "mfa" | "phone_otp" | "password_reset", code: string, minutes = CHALLENGE_MIN) {
    const r = await this.db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO auth_challenges (user_id, organization_id, kind, code_hash, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at`,
      [userId, orgId, kind, sha256(code), new Date(this.now().getTime() + minutes * 60_000)],
    );
    return r.rows[0];
  }

  /**
   * Locks the challenge row, checks expiry/attempts, then runs check(). Single use.
   * MFA failures also count per account, so starting new challenges doesn't reset the limit.
   */
  private async consume(challengeId: string, kind: string, ip: string | null, check: (c: { user_id: string | null; code_hash: Buffer }, q: Queryable) => Promise<boolean>) {
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new HttpError("UNAUTHENTICATED", "This code has expired. Request a new one.");
    const key = `challenge:${challengeId}`;
    await this.throttle([key]);
    return this.db.tx(async (q) => {
      const r = await q.query<{ id: string; user_id: string | null; code_hash: Buffer; attempts: number; expires_at: Date; consumed_at: Date | null }>(
        `SELECT id, user_id, code_hash, attempts, expires_at, consumed_at FROM auth_challenges WHERE id = $1 AND kind = $2 FOR UPDATE`,
        [challengeId, kind],
      );
      const c = r.rows[0];
      if (!c || c.consumed_at || new Date(c.expires_at) <= this.now()) throw new HttpError("UNAUTHENTICATED", "This code has expired. Request a new one.");
      if (c.attempts >= 5) throw new HttpError("RATE_LIMITED", "Too many incorrect codes. Request a new one.");
      // MFA failures also count per account (across challenges). The user row lock serialises
      // concurrent guesses, so the count read here can't be raced past the limit.
      const accountKeys = kind === "mfa" && c.user_id ? [`mfa:${c.user_id}`, `mfa-ip:${c.user_id}|${ip}`] : [];
      if (accountKeys.length) {
        await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [c.user_id]);
        await this.throttle(accountKeys, q);
      }
      const ok = c.user_id !== null && (await check({ user_id: c.user_id, code_hash: Buffer.from(c.code_hash) }, q));
      if (!ok) {
        await q.query(
          `UPDATE auth_challenges SET attempts = attempts + 1, consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE NULL END WHERE id = $1`,
          [c.id],
        );
        for (const k of [key, ...accountKeys]) await this.record(k, false, ip, q);
        return { ok: false as const };
      }
      await q.query(`UPDATE auth_challenges SET consumed_at = now() WHERE id = $1`, [c.id]);
      return { ok: true as const, userId: c.user_id! };
    }).then((res) => {
      if (!res.ok) throw new HttpError("UNAUTHENTICATED", "That code is incorrect.");
      return res.userId;
    });
  }

  private devCode(code: string) {
    return this.deps.config.devStaticCodes && code.trim() === "000000";
  }

  /** Password (or OTP) is only a first factor for privileged roles. */
  async afterFirstFactor(user: UserRow, meta: { ip: string | null; userAgent?: string }, factor: "password" | "otp" = "password"): Promise<SignInResult> {
    if (requiresMfa({ roles: user.roles ?? [] })) {
      // Enrolling a new authenticator needs the password: a phone number an admin can edit
      // must never be enough to bind a fresh second factor to a privileged account.
      if (!user.mfa_enrolled && factor === "otp")
        throw new HttpError("FORBIDDEN", "Sign in with your email and password to set up two-step verification.");
      if (user.mfa_enrolled) {
        const c = await this.newChallenge(user.id, user.organization_id, "mfa", newToken());
        return { status: "mfa_required", challengeId: c.id };
      }
      // First sign-in of a privileged account: enrol an authenticator before any session exists.
      const secret = newTotpSecret();
      await this.db.query(`UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1`, [user.id, encrypt(secret, this.deps.config.dataEncryptionKey)]);
      const c = await this.newChallenge(user.id, user.organization_id, "mfa", newToken(), 15);
      return { status: "mfa_enrollment_required", challengeId: c.id, secret, otpauthUri: otpauthUri(secret, user.email) };
    }
    const s = await this.createSession(this.db, user, false, meta);
    return { status: "ok", ...s };
  }

  async login(emailRaw: string, password: string, meta: { ip: string | null; userAgent?: string }): Promise<SignInResult> {
    const email = emailRaw.trim().toLowerCase();
    const key = `email:${email}`;
    const pairKey = `email-ip:${email}|${meta.ip}`;
    await this.throttle([key, pairKey, `ip:${meta.ip}`]);
    const r = await this.db.query<{ id: string; password_hash: string | null; status: string }>(
      `SELECT id, password_hash, status FROM users WHERE email = $1`, [email],
    );
    const row = r.rows[0];
    const valid = row?.password_hash
      ? await verify(row.password_hash, password).catch(() => false)
      : (await verify(await getDummy(), password).catch(() => false), false);
    if (!row || !valid || row.status !== "active") {
      await this.record(key, false, meta.ip);
      await this.record(pairKey, false, meta.ip);
      await this.record(`ip:${meta.ip}`, false, meta.ip);
      throw new HttpError("UNAUTHENTICATED", "Email or password is incorrect.");
    }
    await this.record(key, true, meta.ip);
    return this.afterFirstFactor((await getUserRow(this.db, row.id))!, meta);
  }

  async verifyMfa(challengeId: string, code: string, meta: { ip: string | null; userAgent?: string }) {
    const key = this.deps.config.dataEncryptionKey;
    let enrolling = false;
    const userId = await this.consume(challengeId, "mfa", meta.ip, async ({ user_id }, q) => {
      // Row lock: two sign-ins racing with the same code can't both pass the replay check.
      const u = await q.query<{ mfa_secret_enc: string | null; mfa_pending_secret_enc: string | null }>(
        `SELECT mfa_secret_enc, mfa_pending_secret_enc FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`, [user_id],
      );
      const row = u.rows[0];
      if (!row) return false;
      const secretBlob = row.mfa_secret_enc ?? row.mfa_pending_secret_enc;
      if (!secretBlob) return false;
      enrolling = !row.mfa_secret_enc;
      if (this.devCode(code)) return true;
      const now = this.now().getTime();
      const step = matchTotp(decrypt(secretBlob, key), code, now);
      if (step === null) return false;
      // Replay protection: refuse this step if it, or a later one, was already accepted. Used steps
      // are at most one ahead of the clock, so only the steps from here to now+1 need checking.
      const newest = Math.floor(now / 30_000) + 1;
      const keys = Array.from({ length: Math.max(0, newest - step + 1) }, (_, i) => `totp:${user_id}:${step + i}`);
      const used = await q.query(`SELECT 1 FROM auth_attempts WHERE key = ANY($1) AND succeeded LIMIT 1`, [keys]);
      if (used.rows.length) return false;
      await q.query(`INSERT INTO auth_attempts (key, succeeded, occurred_at) VALUES ($1, true, $2)`, [`totp:${user_id}:${step}`, this.now()]);
      return true;
    });
    return this.db.tx(async (q) => {
      if (enrolling) {
        await q.query(
          `UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enrolled = true WHERE id = $1 AND mfa_pending_secret_enc IS NOT NULL`,
          [userId],
        );
        const u = await getUserRow(q, userId);
        await q.query(
          `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'auth.mfa_enrolled', 'user', $2)`,
          [u!.organization_id, userId],
        );
      }
      const user = (await getUserRow(q, userId))!;
      return this.createSession(q, user, true, meta);
    });
  }

  async requestOtp(phone: string, meta: { ip: string | null }) {
    if (this.deps.config.smsProvider === "none" && !this.deps.config.devStaticCodes) {
      throw new HttpError("CONFIG", "Phone sign-in isn't available yet. Use email and password.");
    }
    const e164 = toE164(phone);
    const key = `phone:${e164 ?? phone}`;
    await this.throttle([key, `ip:${meta.ip}`]);
    // Count every request toward the window so OTP requests can't be used to flood a number.
    await this.record(key, false, meta.ip);
    const u = e164
      ? (await this.db.query<{ id: string; organization_id: string }>(`SELECT id, organization_id FROM users WHERE phone_e164 = $1 AND status = 'active'`, [e164])).rows[0]
      : undefined;
    const code = newNumericCode();
    // Unknown numbers get an identical response and a challenge that can never verify.
    const c = await this.newChallenge(u?.id ?? null, u?.organization_id ?? null, "phone_otp", code);
    if (u && e164) await this.deps.messages.send({ channel: "sms", recipient: e164, template: "login_otp", payload: { code } });
    return { challengeId: c.id, expiresAt: new Date(c.expires_at).toISOString() };
  }

  async verifyOtp(challengeId: string, code: string, meta: { ip: string | null; userAgent?: string }) {
    const userId = await this.consume(challengeId, "phone_otp", meta.ip, async ({ code_hash }) =>
      this.devCode(code) || safeEqual(code_hash, sha256(code.trim())),
    );
    const user = await getUserRow(this.db, userId);
    if (!user || user.status !== "active") throw new HttpError("UNAUTHENTICATED", "That code is incorrect.");
    return this.afterFirstFactor(user, meta, "otp");
  }

  async forgotPassword(emailRaw: string, meta: { ip: string | null }) {
    const email = emailRaw.trim().toLowerCase();
    const key = `reset:${email}`;
    await this.throttle([key, `reset-ip:${meta.ip}`]);
    await this.record(key, false, meta.ip);
    await this.record(`reset-ip:${meta.ip}`, false, meta.ip);
    const u = (await this.db.query<{ id: string; organization_id: string }>(`SELECT id, organization_id FROM users WHERE email = $1 AND status IN ('active','invited')`, [email])).rows[0];
    if (!u) return;
    await this.sendResetLink(u.id, u.organization_id, email, "password_reset", 30);
  }

  /**
   * Issues a single-use set-password link. With no email provider it can't be delivered: the
   * outbox records that, and the link comes back to the caller. Only admin routes may hand it on
   * (forgotPassword discards it). The token itself is stored only as a hash.
   */
  async sendResetLink(userId: string, orgId: string, email: string, template: "password_reset" | "invite", minutes: number) {
    const token = newToken();
    const c = await this.newChallenge(userId, orgId, "password_reset", token, minutes);
    const link = `${this.deps.config.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const sent = await this.deps.messages.send({ channel: "email", recipient: email, template, payload: { link } });
    if (!sent) {
      // No provider: keep it in the outbox so an operator can see delivery is blocked. The link is not stored.
      await this.db.query(
        `INSERT INTO outbox_messages (organization_id, channel, recipient, template, payload, status, last_error) VALUES ($1, 'email', $2, $3, '{}', 'blocked', 'No email provider configured')`,
        [orgId, email, template],
      );
    }
    return { sent, link: sent ? null : link, expiresAt: new Date(c.expires_at).toISOString() };
  }

  async resetPassword(token: string, password: string) {
    const r = await this.db.query<{ id: string; user_id: string; email: string }>(
      `SELECT c.id, c.user_id, u.email FROM auth_challenges c JOIN users u ON u.id = c.user_id
        WHERE c.kind = 'password_reset' AND c.code_hash = $1 AND c.consumed_at IS NULL AND c.expires_at > $2`,
      [sha256(token), this.now()],
    );
    const c = r.rows[0];
    if (!c) throw new HttpError("UNAUTHENTICATED", "This reset link has expired. Request a new one.");
    const problem = passwordProblem(password, c.email);
    if (problem) throw new HttpError("VALIDATION", problem, { password: [problem] });
    const h = await hashPassword(password);
    await this.db.tx(async (q) => {
      await q.query(`UPDATE auth_challenges SET consumed_at = now() WHERE id = $1`, [c.id]);
      await q.query(`UPDATE auth_challenges SET consumed_at = now() WHERE user_id = $1 AND kind = 'password_reset' AND consumed_at IS NULL`, [c.user_id]);
      await q.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now(), status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
                email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`,
        [c.user_id, h],
      );
      await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [c.user_id]);
      const org = (await q.query<{ organization_id: string }>(`SELECT organization_id FROM users WHERE id = $1`, [c.user_id])).rows[0];
      await q.query(
        `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'auth.password_reset', 'user', $2)`,
        [org.organization_id, c.user_id],
      );
    });
  }

  async changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
    const r = await this.db.query<{ password_hash: string | null; email: string; organization_id: string }>(`SELECT password_hash, email, organization_id FROM users WHERE id = $1`, [userId]);
    const u = r.rows[0];
    await this.throttle([`change:${userId}`]);
    if (!u?.password_hash || !(await verify(u.password_hash, current).catch(() => false))) {
      await this.record(`change:${userId}`, false, null);
      throw new HttpError("VALIDATION", "Current password is incorrect.", { currentPassword: ["Incorrect"] });
    }
    const problem = passwordProblem(next, u.email);
    if (problem) throw new HttpError("VALIDATION", problem, { newPassword: [problem] });
    await this.db.query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [userId, await hashPassword(next)]);
    // Sign out every other device: a stolen session must not survive a password change.
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2::uuid`, [userId, keepSessionId ?? null]);
    await this.db.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'auth.password_changed', 'user', $2)`,
      [u.organization_id, userId],
    );
  }

  async logoutToken(token: string) {
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
  }
}
