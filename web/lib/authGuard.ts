import { NextRequest, NextResponse } from "next/server";
import { parseSession } from "./session";

export function requireAuth(req: NextRequest): { authed: boolean; user?: string; response?: NextResponse } {
  const session = parseSession(req);
  if (!session) {
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    res.cookies.delete("session_token");
    return { authed: false, response: res };
  }
  return { authed: true, user: session.user };
}
