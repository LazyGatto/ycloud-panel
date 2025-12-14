import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { loadConfig, saveConfig } from "@server/configStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const cfg = await loadConfig();
  return NextResponse.json({ ips: cfg.ips ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const { ips } = await req.json();
  const cfg = await loadConfig();
  const next = { ...cfg, ips: Array.isArray(ips) ? ips : cfg.ips };
  const saved = await saveConfig(next);
  return NextResponse.json({ ips: saved.ips ?? [] });
}
