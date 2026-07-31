/**
 * Password gate for /admin.
 *
 * One shared password from the environment, exchanged for a signed cookie. That
 * is proportionate here: the only thing behind the gate is a list of birthday
 * recordings, and the alternative is a login form on the gift itself.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SECRET = process.env.SESSION_SECRET ?? PASSWORD ?? "labyrinth";
export const COOKIE = "lb_admin";

export const passwordConfigured = PASSWORD.length > 0;

function tokenFor(password: string): string {
  return createHmac("sha256", SECRET).update(`admin:${password}`).digest("hex");
}

const EXPECTED = tokenFor(PASSWORD);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  if (!passwordConfigured) return false;
  return safeEqual(tokenFor(candidate), EXPECTED);
}

export function sessionCookie(): string {
  const parts = [
    `${COOKIE}=${EXPECTED}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function isAuthed(req: Request): boolean {
  if (!passwordConfigured) return false;
  const header = req.headers.get("cookie") ?? "";
  for (const chunk of header.split(";")) {
    const [k, ...rest] = chunk.trim().split("=");
    if (k === COOKIE) return safeEqual(rest.join("="), EXPECTED);
  }
  return false;
}
