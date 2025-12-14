import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { fetchCidrs, loadCachedCidrs } from "@server/ipService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const refresh = req.nextUrl.searchParams.get("refresh") === "true";
  try {
    const cidrs = refresh ? await fetchCidrs() : await loadCachedCidrs();
    if (!refresh && cidrs.length === 0) {
      const fresh = await fetchCidrs();
      return NextResponse.json({ cidrs: fresh });
    }
    return NextResponse.json({ cidrs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
