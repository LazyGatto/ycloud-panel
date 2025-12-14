import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import fs from "fs";
import path from "path";
import { loadConfig, saveConfig } from "@server/configStore";
import type { VmEntry } from "@server/types";
import { createClient } from "@yc/core/http";
import { getIamToken } from "@yc/core/auth";
import { listInstances } from "@yc/services/compute";

export const dynamic = "force-dynamic";

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const cfg = await loadConfig();
  const requestedAccountId = req.nextUrl.searchParams.get("accountId");
  const accounts = cfg.ycAccounts ?? [];
  if (accounts.length === 0) {
    return NextResponse.json({ error: "accounts not configured" }, { status: 400 });
  }

  const targetAccounts = requestedAccountId
    ? accounts.filter((a) => a.id === requestedAccountId)
    : accounts;

  const allVms: VmEntry[] = [];

  for (const acc of targetAccounts) {
    if (!acc?.folderId || !acc?.zoneId) continue;
    const keyPath = resolveKeyPath(acc.id);
    if (acc.keyContent) {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, acc.keyContent, "utf8");
    }
    try {
      const iamToken = await getIamToken({ keyFile: keyPath, iamUrl: process.env.YC_IAM_URL });
      const computeBase = process.env.YC_COMPUTE_API || "https://compute.api.cloud.yandex.net/compute/v1";
      const computeClient = createClient(computeBase, iamToken);
      const instances = await listInstances(computeClient, acc.folderId);
      const vms: VmEntry[] = instances.map((ins) => {
        const nic = ins.networkInterfaces?.[0]?.primaryV4Address;
        return {
          id: ins.id,
          name: ins.name,
          status: ins.status,
          cloud: "yandex" as const,
          accountId: acc.id,
          ip: nic?.oneToOneNat?.address ?? nic?.address ?? "",
          details: {
            cores: ins.resources?.cores,
            coreFraction: ins.resources?.coreFraction,
            memoryBytes: ins.resources?.memory,
            preemptible: ins.schedulingPolicy?.preemptible,
            platformId: ins.platformId,
            internalIp: nic?.address,
            publicIp: nic?.oneToOneNat?.address,
          },
          pingIntervalMs: 120000,
          pingTimeoutMs: 45000,
          monitorMethod: "api",
        };
      });
      allVms.push(...vms);
    } catch (err) {
      // пропускаем аккаунт при ошибке, чтобы не ронять весь запрос
      console.error("Failed to refresh VMs for account", acc.id, err);
    }
  }

  const saved = await saveConfig({ ...cfg, vms: allVms });
  return NextResponse.json({ vms: saved.vms ?? [] });
}
