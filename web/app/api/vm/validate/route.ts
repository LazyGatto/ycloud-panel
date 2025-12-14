import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { loadConfig } from "@server/configStore";
import { fetchYcInstance } from "@server/vmService";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const { id, cloud, ip, accountId } = await req.json();
  if (!id || !cloud) return NextResponse.json({ error: "vm id and cloud are required" }, { status: 400 });

  const cfg = await loadConfig();

  if (cloud === "yandex") {
    try {
      const account = cfg.ycAccounts?.find((a) => a.id === accountId) ?? cfg.ycAccounts?.[0];
      if (!account) return NextResponse.json({ error: "YC account not found" }, { status: 400 });
      const info = await fetchYcInstance(account, id);
      if (!info) return NextResponse.json({ error: "VM not found" }, { status: 404 });
      if (!info.ip) return NextResponse.json({ error: "VM has no public IP" }, { status: 400 });
      return NextResponse.json({
        ok: true,
        vm: {
          id: info.id,
          name: info.name,
          status: info.status,
          ip: info.ip,
          details: info.details,
          cloud,
          statusFetchedAt: Date.now(),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  // For VK (or others) skip validation for now, just echo back.
  return NextResponse.json({
    ok: true,
    vm: { id, ip, cloud },
  });
}
