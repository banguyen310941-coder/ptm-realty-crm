import { createHash, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";

export function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

export async function sessionUserFromToken(token) {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await query(
    `SELECT u.id,u.name,u.email,u.role
       FROM public.crm_sessions s
       JOIN public.users u ON u.id=s.user_id
      WHERE s.token_hash=$1
        AND s.expires_at>now()
        AND u.active=true
      LIMIT 1`,
    [tokenHash]
  );
  return rows?.[0] || null;
}

export function safeSecretEqual(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a,b);
}
