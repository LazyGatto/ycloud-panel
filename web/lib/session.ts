import crypto from "crypto";
const COOKIE_NAME = "session_token";

function getSecret(): string {
  return process.env.SESSION_SECRET || "dev-secret-change-me";
}

function getTtlMs(): number {
  const ttl = Number(process.env.SESSION_TTL_SECONDS ?? "86400");
  return ttl * 1000;
}

export function createSession(user: string): { value: string; maxAge: number } {
  const exp = Date.now() + getTtlMs();
  const payload = `${user}:${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  const token = Buffer.from(`${payload}:${sig}`).toString("base64url");
  return { value: token, maxAge: Math.floor(getTtlMs() / 1000) };
}

type CookieSource = { cookies: { get(name: string): { value: string } | undefined } };

export function parseSession(req: Request | CookieSource): { user: string } | null {
  // @ts-ignore
  const cookieValue = typeof req === "object" && "cookies" in req ? (req as CookieSource).cookies.get(COOKIE_NAME)?.value : undefined;
  if (!cookieValue) return null;
  try {
    const raw = Buffer.from(cookieValue, "base64url").toString("utf8");
    const [user, expStr, sig] = raw.split(":");
    const exp = Number(expStr);
    if (!user || !exp || !sig) return null;
    if (Date.now() > exp) return null;
    const payload = `${user}:${exp}`;
    const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
    if (sig !== expected) return null;
    return { user };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
