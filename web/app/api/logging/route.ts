import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/authGuard";
import { listLogs } from "../../../../server/jobManager";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "200");
  const logs = listLogs(jobId ?? undefined, limit);
  return NextResponse.json({ logs });
}
