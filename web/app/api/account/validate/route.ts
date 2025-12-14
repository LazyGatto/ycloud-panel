import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import fs from "fs";
import path from "path";
import axios from "axios";
import { loadServiceAccountKey, createJwt } from "../../../../../src/yc/core/auth";
import { describeAxiosError } from "../../../../../src/yc/core/http";
import { loadConfig } from "@server/configStore";
import { createClient } from "../../../../../src/yc/core/http";
import { listInstances } from "../../../../../src/yc/services/compute";
import { listAddresses } from "../../../../../src/yc/services/vpc";

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;

  const body = await req.json();
  const { type, keyContent, folderId, zoneId, id } = body as {
    type?: "yandex" | "vk";
    keyContent?: string;
    folderId?: string;
    zoneId?: string;
    id?: string;
  };

  if (type !== "yandex") {
    // TODO: implement VK token validation if needed
    return NextResponse.json({ ok: true, message: "VK validation skipped" });
  }

  const cfg = await loadConfig();
  const existing = [...(cfg.ycAccounts ?? [])].find((a) => a.id === id);
  const effectiveKey = keyContent || existing?.keyContent;
  const effectiveFolder = folderId || existing?.folderId;
  const effectiveZone = zoneId || existing?.zoneId;

  if (!effectiveKey || !effectiveFolder || !effectiveZone) {
    return NextResponse.json({ error: "folderId, zoneId и ключ обязательны" }, { status: 400 });
  }

  try {
    const keyPath = resolveKeyPath(id);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, effectiveKey, "utf8");

    // Validate key structure and exchange JWT for IAM token without caches.
    const iamUrl = process.env.YC_IAM_URL || "https://iam.api.cloud.yandex.net/iam/v1/tokens";
    const iamBase = process.env.YC_IAM_API || "https://iam.api.cloud.yandex.net/iam/v1";
    const key = loadServiceAccountKey(keyPath);
    const jwt = createJwt(key, iamUrl);
    const { data: iamResp } = await axios.post<{ iamToken: string; expiresAt: string }>(
      iamUrl,
      { jwt },
      { timeout: 15000 },
    );
    const iamToken = iamResp.iamToken;

    // Verify folder access
    const rmBase =
      process.env.YC_RESOURCE_MANAGER_API ||
      "https://resource-manager.api.cloud.yandex.net/resource-manager/v1";
    await axios.get(`${rmBase}/folders/${effectiveFolder}`, {
      headers: { Authorization: `Bearer ${iamToken}` },
      timeout: 10000,
    });

    // Fetch service account info (name/description)
    let saName: string | undefined;
    let saDescription: string | undefined;
    let saRoles: string[] | undefined;
    try {
      const saId = key.service_account_id;
      const { data: saData } = await axios.get<{ name?: string; description?: string }>(
        `${iamBase}/serviceAccounts/${saId}`,
        { headers: { Authorization: `Bearer ${iamToken}` }, timeout: 10000 },
      );
      saName = saData.name;
      saDescription = saData.description;

      // roles in folder bindings
      const { data: bindings } = await axios.post<{ accessBindings?: { roleId?: string; subject?: { id?: string } }[] }>(
        `${rmBase}/folders/${folderId}:listAccessBindings`,
        {},
        { headers: { Authorization: `Bearer ${iamToken}` }, timeout: 10000 },
      );
      saRoles = (bindings.accessBindings ?? [])
        .filter((b) => b.subject?.id === saId)
        .map((b) => b.roleId)
        .filter(Boolean) as string[];
    } catch {
      // ignore info fetch errors, validation already succeeded
    }

    const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
    const computeBase = process.env.YC_COMPUTE_API || "https://compute.api.cloud.yandex.net/compute/v1";
    const vpcClient = createClient(vpcBase, iamToken);
    const computeClient = createClient(computeBase, iamToken);

    // Fetch resources
    const [instances, addresses] = await Promise.all([
      listInstances(computeClient, effectiveFolder),
      listAddresses(vpcClient, effectiveFolder),
    ]);

    // log raw
    const logPath = path.resolve(process.cwd(), "logs", `yc-fetch-${id ?? "new"}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      JSON.stringify({ instances, addresses }, null, 2),
      "utf8",
    );

    // Map VMs/IPs
    const vms = instances.map((ins) => {
      const nic = ins.networkInterfaces?.[0]?.primaryV4Address;
      return {
        id: ins.id,
        name: ins.name,
        status: ins.status,
        cloud: "yandex" as const,
        accountId: id,
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
      };
    });

    const ips = addresses.map((addr) => ({
      id: addr.id,
      address: addr.externalIpv4Address?.address ?? "",
      zoneId: addr.externalIpv4Address?.zoneId,
      deletionProtection: addr.reserved ?? false,
      status: addr.reserved ? "reserved" : "free",
      accountId: id,
    }));

    return NextResponse.json({
      ok: true,
      message: "validated",
      info: { saName, saDescription, saRoles },
      vms,
      ips,
    });
  } catch (err) {
    const message = describeAxiosError(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
