import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { sessionSecret } from "@/lib/env";

export type SessionPayload = { uid: number; tid: number; sid: string; iat: number; exp: number };

const SESSION_TTL_SEC = 12 * 3600;

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string) {
  return createHmac("sha256", sessionSecret()).update(data).digest("base64url");
}

/** Stateless HMAC-signed session token. Account status is re-checked from the DB on every request,
 * so bans/suspensions apply immediately regardless of how many sessions exist. */
export function createSession(uid: number, tid: number): { token: string; exp: number } {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { uid, tid, sid: randomBytes(8).toString("hex"), iat: now, exp: now + SESSION_TTL_SEC };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, exp: payload.exp };
}

export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token || token.length > 1024) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof p.uid !== "number" || typeof p.tid !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
