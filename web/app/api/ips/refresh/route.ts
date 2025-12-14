import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import fs from "fs";
import path from "path";
import { loadConfig, saveConfig } from "@server/configStore";
import type { VmEntry } from "@server/types";
import { createClient } from "@yc/core/http";
import { getIamToken } from "@yc/core/auth";
import { listAddresses } from "@yc/services/vpc";

export const dynamic = "force-dynamic";

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const cfg = await loadConfig();
  const accounts = cfg.ycAccounts ?? [];
  if (accounts.length === 0) {
    return NextResponse.json({ error: "No YC accounts configured" }, { status: 400 });
  }
  const vms: VmEntry[] = cfg.vms ?? [];

  const allIps: any[] = [];
  for (const acc of accounts) {
    if (!acc.folderId || !acc.zoneId) continue;
    const keyPath = resolveKeyPath(acc.id);
    if (acc.keyContent) {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, acc.keyContent, "utf8");
    }
    const iamToken = await getIamToken({ keyFile: keyPath, iamUrl: process.env.YC_IAM_URL });
    const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
    const vpcClient = createClient(vpcBase, iamToken);
    const addresses = await listAddresses(vpcClient, acc.folderId);
    const mapped = addresses
      .map((addr) => {
        const address = addr.externalIpv4Address?.address ?? "";
        const matchedVm = vms.find(
          (vm) => vm.accountId === acc.id && (vm.ip === address || vm.details?.publicIp === address),
        );
        return {
          id: addr.id,
          address,
          zoneId: addr.externalIpv4Address?.zoneId,
          deletionProtection: (addr as any).deletionProtection ?? addr.reserved ?? false,
          status: addr.reserved ? "reserved" : "free",
          accountId: acc.id,
          assignedTo: matchedVm
            ? {
                vmId: matchedVm.id,
                vmName: matchedVm.name,
              }
            : undefined,
        };
      })
      // пропускаем пустые записи без реального адреса
      .filter((ip) => ip.address);
    allIps.push(...mapped);
  }

  const saved = await saveConfig({ ...cfg, ips: allIps });
  return NextResponse.json({ ips: saved.ips ?? [] });
}
