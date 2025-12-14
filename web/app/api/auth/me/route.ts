import { NextRequest, NextResponse } from "next/server";
import { parseSession } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  const session = parseSession(req);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, user: session.user });
}
