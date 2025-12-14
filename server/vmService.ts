import fs from "fs";
import path from "path";
import { createClient } from "../src/yc/core/http";
import { getIamToken } from "../src/yc/core/auth";
import { CloudCredentials } from "./types";

export type VmInfo = {
  id: string;
  name?: string;
  status?: string;
  cloud: "yandex" | "vk";
  ip?: string;
  details?: {
    cores?: number;
    coreFraction?: number;
    memoryBytes?: number;
    preemptible?: boolean;
    platformId?: string;
    internalIp?: string;
    publicIp?: string;
  };
};

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

export async function fetchYcInstance(
  account: CloudCredentials | undefined,
  instanceId: string,
): Promise<VmInfo | null> {
  const yc = account;
  if (!yc?.folderId || !yc?.zoneId) return null;
  const keyPath = resolveKeyPath(yc.id);
  if (yc.keyContent) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, yc.keyContent, "utf8");
  }
  const iamToken = await getIamToken({
    keyFile: keyPath,
    iamUrl: process.env.YC_IAM_URL,
  });
  const base = process.env.YC_COMPUTE_API || "https://compute.api.cloud.yandex.net/compute/v1";
  const client = createClient(base, iamToken);
  const { data } = await client.get<{
    id: string;
    name?: string;
    status?: string;
    platformId?: string;
    resources?: { cores?: number; coreFraction?: number; memory?: number };
    schedulingPolicy?: { preemptible?: boolean };
    networkInterfaces?: { primaryV4Address?: { oneToOneNat?: { address?: string }; address?: string } }[];
  }>(
    `/instances/${instanceId}`,
  );
  const primary = data.networkInterfaces?.[0]?.primaryV4Address;
  const publicIp = primary?.oneToOneNat?.address; // публичный IP обязателен для мониторинга
  const internalIp = primary?.address;
  const ip = publicIp;
  const details = {
    cores: data.resources?.cores,
    coreFraction: data.resources?.coreFraction,
    memoryBytes: data.resources?.memory,
    preemptible: data.schedulingPolicy?.preemptible,
    platformId: data.platformId,
    internalIp,
    publicIp,
  };
  return { id: data.id, name: data.name, status: data.status, cloud: "yandex", ip, details };
}
