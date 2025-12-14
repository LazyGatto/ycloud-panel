import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { loadConfig, saveConfig } from "@server/configStore";
import fs from "fs";
import path from "path";
import { getIamToken } from "../../../../../src/yc/core/auth";
import { createClient, describeAxiosError } from "../../../../../src/yc/core/http";
import { deleteAddress } from "../../../../../src/yc/services/vpc";

export const dynamic = "force-dynamic";

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const cfg = await loadConfig();
  const ip = (cfg.ips ?? []).find((a) => a.id === id);
  if (!ip) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ip.deletionProtection) return NextResponse.json({ error: "deletion protection enabled" }, { status: 400 });

  // pick account owning the IP
  const acc =
    (cfg.ycAccounts ?? []).find((a) => a.id === ip.accountId) ??
    (cfg.ycAccounts ?? [])[0];
  if (!acc?.folderId || !acc.zoneId) return NextResponse.json({ error: "account not configured" }, { status: 400 });
  const keyPath = resolveKeyPath(acc.id);
  if (acc.keyContent) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, acc.keyContent, "utf8");
  }
  try {
    const iamToken = await getIamToken({ keyFile: keyPath, iamUrl: process.env.YC_IAM_URL });
    const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
    const opBase = process.env.YC_OPERATION_API || "https://operation.api.cloud.yandex.net/operations";
    const vpcClient = createClient(vpcBase, iamToken);
    const opClient = createClient(opBase, iamToken);
    await deleteAddress(vpcClient, opClient, id, id);
    const saved = await saveConfig({ ...cfg, ips: (cfg.ips ?? []).filter((a) => a.id !== id) });
    return NextResponse.json({ ips: saved.ips ?? [] });
  } catch (err) {
    const message = describeAxiosError(err);
    const status = (err as any)?.response?.status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
