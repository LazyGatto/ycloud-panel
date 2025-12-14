import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import fs from "fs";
import path from "path";
import { loadConfig, saveConfig } from "@server/configStore";
import { getIamToken } from "@yc/core/auth";
import { createClient } from "@yc/core/http";
import { allocateAddress, deleteAddress } from "@yc/services/vpc";
import { fetchCidrs, loadCachedCidrs } from "@server/ipService";

export const dynamic = "force-dynamic";

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, mask] = cidr.split("/");
  if (!base || !mask) return false;
  const maskBits = Number(mask);
  const ipLong = ipToLong(ip);
  const baseLong = ipToLong(base);
  const maskLong = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipLong & maskLong) === (baseLong & maskLong);
}

function maskMatches(ip: string, maskPattern: string): boolean {
  const regex = new RegExp("^" + maskPattern.replace("*", "\\d{1,3}") + "$ ".trim());
  return regex.test(ip);
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const { accountId, useTarget, targetCidrs, mask, attempts = 10, minDelayMs = 5000, maxDelayMs = 15000 } =
    await req.json();

  const cfg = await loadConfig();
  const account = (cfg.ycAccounts ?? []).find((a) => a.id === accountId) ?? cfg.ycAccounts?.[0];
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 400 });
  if (!account.folderId || !account.zoneId) return NextResponse.json({ error: "Account not configured" }, { status: 400 });

  const max = account.maxAddresses ?? 2;
  const ipsForAccount = (cfg.ips ?? []).filter((ip) => ip.accountId === account.id);
  if (ipsForAccount.length >= max) {
    return NextResponse.json({ error: `Address limit reached for ${account.name} (${max})` }, { status: 400 });
  }

  let cidrList: string[] = [];
  if (useTarget) {
    cidrList = (await loadCachedCidrs()).length > 0 ? await loadCachedCidrs() : await fetchCidrs();
    const selected = (targetCidrs as string[] | undefined)?.filter(Boolean) ?? [];
    if (selected.length === 0 && !mask) {
      return NextResponse.json({ error: "Укажите целевой CIDR или маску" }, { status: 400 });
    }
    const maskOk = mask ? cidrList.some((c) => inCidr(mask.replace("*", "0"), c)) : true;
    if (mask && !maskOk) {
      return NextResponse.json({ error: "Маска не попадает в доступные CIDR" }, { status: 400 });
    }
    cidrList = selected.length > 0 ? selected : cidrList;
  }

  const keyPath = resolveKeyPath(account.id);
  if (account.keyContent) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, account.keyContent, "utf8");
  }
  const iamToken = await getIamToken({ keyFile: keyPath, iamUrl: process.env.YC_IAM_URL });
  const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
  const opBase = process.env.YC_OPERATION_API || "https://operation.api.cloud.yandex.net/operations";
  const vpcClient = createClient(vpcBase, iamToken);
  const opClient = createClient(opBase, iamToken);

  let lastError: string | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const addr = await allocateAddress(vpcClient, opClient, account.folderId!, account.zoneId!, account.labelKey, account.labelValue);
      const ip = addr.externalIpv4Address?.address ?? "";
      const matchesTarget = !useTarget || ((cidrList.some((c) => inCidr(ip, c))) || (mask ? maskMatches(ip, mask) : false));
      if (matchesTarget) {
        const next = {
          ...cfg,
          ips: [
            ...(cfg.ips ?? []).filter((a) => a.id !== addr.id),
            {
              id: addr.id,
              address: ip,
              zoneId: addr.externalIpv4Address?.zoneId,
              deletionProtection: (addr as any).deletionProtection ?? false,
              status: addr.reserved ? "reserved" : "free",
              accountId: account.id,
            },
          ],
        };
        const saved = await saveConfig(next);
        return NextResponse.json({ ip: ip, ips: saved.ips ?? [] });
      } else {
        await deleteAddress(vpcClient, opClient, addr.id, addr.id);
        lastError = `IP ${ip} не подходит под целевые CIDR/маску`;
        if (i < attempts - 1) await randomDelay(minDelayMs, maxDelayMs);
      }
    } catch (err) {
      lastError = (err as Error).message;
      if (i < attempts - 1) await randomDelay(minDelayMs, maxDelayMs);
    }
  }

  return NextResponse.json({ error: lastError ?? "Не удалось получить адрес" }, { status: 400 });
}
