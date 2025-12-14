import { NextResponse } from "next/server";
import { createSession, COOKIE_NAME } from "../../../../lib/session";

export async function POST(req: Request) {
  const { username, password } = await req.json();
  const expectedUser = process.env.BASIC_AUTH_USER || "admin";
  const expectedPass = process.env.BASIC_AUTH_PASS || "admin";
  if (username !== expectedUser || password !== expectedPass) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const session = createSession(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: session.maxAge,
    secure: false,
    path: "/",
  });
  return res;
}
