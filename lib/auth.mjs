import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = "tenea_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 días

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function genTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[crypto.randomInt(chars.length)];
  return `Tenea-${out}`;
}

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(input) {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET no configurado");
  return s;
}

export function createSessionToken(payload, ttlSeconds = SESSION_TTL) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const bodyStr = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", getSecret()).update(bodyStr).digest();
  return `${bodyStr}.${b64url(sig)}`;
}

export function verifySessionToken(token) {
  if (!token) return null;
  const [bodyStr, sigStr] = token.split(".");
  if (!bodyStr || !sigStr) return null;
  const expectedSig = b64url(crypto.createHmac("sha256", getSecret()).update(bodyStr).digest());
  const a = Buffer.from(sigStr);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(bodyStr).toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getCookie(cookieHeader, name) {
  const cookie = cookieHeader || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getSession(cookieHeader) {
  return verifySessionToken(getCookie(cookieHeader, SESSION_COOKIE));
}

export function setSessionCookie(payload) {
  const token = createSessionToken(payload);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
