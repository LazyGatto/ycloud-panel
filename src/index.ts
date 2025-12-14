import axios, { AxiosInstance } from "axios";
import fs from "fs";
import path from "path";
import { AxiosError } from "axios";

type FloatingIp = {
  id: string;
  floating_ip_address: string;
  port_id: string | null;
  fixed_ip_address: string | null;
  status: string;
  project_id?: string;
  tenant_id?: string;
  router_id?: string | null;
  subnet_id?: string | null;
};

type FloatingIpResponse = {
  floatingip: FloatingIp;
};

type FloatingIpListResponse = {
  floatingips: FloatingIp[];
};

type Subnet = {
  id: string;
  name: string;
  cidr: string;
};

type SubnetListResponse = {
  subnets: Subnet[];
};

type Network = {
  id: string;
  name: string;
  "router:external"?: boolean;
};

type NetworkListResponse = {
  networks: Network[];
};

const TARGET_CIDRS = [
  "217.16.16.0/21", // ext-sub8
  "217.16.24.0/22", // ext-sub9
  "95.163.248.0/22", // ext-sub35
];

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(
  LOG_DIR,
  `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
);

async function logLine(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  await fs.promises.appendFile(LOG_FILE, `${line}\n`, "utf8");
}

function describeAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return (error as Error)?.message ?? String(error);
  }

  const err = error as AxiosError;
  const status = err.response?.status;
  const data = err.response?.data;
  const url = err.config?.url;
  return `status=${status ?? "unknown"} url=${url ?? "unknown"} message=${err.message} response=${JSON.stringify(
    data,
    null,
    2,
  )}`;
}

function isNoMoreIpsError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const neutronError = (error.response?.data as { NeutronError?: { message?: string; type?: string } })?.NeutronError;
  if (!neutronError) return false;
  const message = neutronError.message?.toLowerCase() ?? "";
  return (
    neutronError.type === "HTTPConflict" &&
    (message.includes("no more ip addresses") || message.includes("no more ip address"))
  );
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function parseCidr(cidr: string) {
  const [ip, maskStr] = cidr.split("/");
  const maskBits = Number(maskStr);
  const mask =
    maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return { network: ipToInt(ip) & mask, mask };
}

function isIpInTargetRange(ip: string): boolean {
  return TARGET_CIDRS.some((cidr) => {
    const { network, mask } = parseCidr(cidr);
    return (ipToInt(ip) & mask) === network;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPauseMs(): number {
  const minMs = 60_000;
  const maxMs = 180_000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function createClient(token: string, baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: {
      "X-Auth-Token": token,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

async function listFloatingIps(client: AxiosInstance): Promise<FloatingIp[]> {
  const { data } = await client.get<FloatingIpListResponse>("/v2.0/floatingips");
  return data.floatingips;
}

async function cleanupNonTargetFloatingIps(client: AxiosInstance): Promise<void> {
  const floatingIps = await listFloatingIps(client);
  const nonTarget = floatingIps.filter((ip) => !isIpInTargetRange(ip.floating_ip_address));

  if (nonTarget.length === 0) {
    await logLine("No non-target floating IPs to clean up.");
    return;
  }

  await logLine(
    `Cleaning up ${nonTarget.length} non-target floating IP(s): ${nonTarget
      .map((ip) => `${ip.floating_ip_address} (${ip.id})`)
      .join(", ")}`,
  );

  for (const ip of nonTarget) {
    try {
      await deleteFloatingIp(client, ip.id);
      await logLine(`Deleted non-target floating IP ${ip.floating_ip_address} (${ip.id}).`);
    } catch (err) {
      await logLine(`Failed to delete floating IP ${ip.floating_ip_address} (${ip.id}): ${describeAxiosError(err)}`);
    }
  }
}

async function listSubnets(client: AxiosInstance): Promise<Subnet[]> {
  const { data } = await client.get<SubnetListResponse>("/v2.0/subnets");
  return data.subnets;
}

async function listExternalNetworks(client: AxiosInstance): Promise<Network[]> {
  const { data } = await client.get<NetworkListResponse>(
    "/v2.0/networks",
    { params: { "router:external": true } },
  );
  return data.networks;
}

async function allocateFloatingIp(
  client: AxiosInstance,
  floatingNetworkId: string,
  subnetId?: string,
): Promise<FloatingIp> {
  const payload = {
    floatingip: {
      floating_network_id: floatingNetworkId,
      ...(subnetId ? { subnet_id: subnetId } : {}),
    },
  };

  const { data } = await client.post<FloatingIpResponse>("/v2.0/floatingips", payload);
  return data.floatingip;
}

async function deleteFloatingIp(client: AxiosInstance, id: string): Promise<void> {
  await client.delete(`/v2.0/floatingips/${id}`);
}

async function determineFloatingNetworkId(client: AxiosInstance): Promise<string | undefined> {
  if (process.env.FLOATING_NETWORK_ID) {
    return process.env.FLOATING_NETWORK_ID;
  }

  const networks = await listExternalNetworks(client);
  const selected = networks.find((net) => net["router:external"]);
  return selected?.id;
}

async function pickTargetSubnets(client: AxiosInstance): Promise<Subnet[]> {
  const subnets = await listSubnets(client);
  const matched = subnets.filter((subnet) => TARGET_CIDRS.includes(subnet.cidr));

  // Shuffle to avoid always picking the same first subnet.
  for (let i = matched.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [matched[i], matched[j]] = [matched[j], matched[i]];
  }

  return matched;
}

async function handleIteration(
  client: AxiosInstance,
  floatingNetworkId: string,
  targetSubnets: Subnet[],
  iterationIndex?: number,
): Promise<boolean> {
  const existing = await listFloatingIps(client);
  const summary = existing.map((ip) => `${ip.floating_ip_address} [${ip.status}]`).join(", ") || "none";
  await logLine(`Iteration ${iterationIndex ?? 0}: existing floating IPs -> ${summary}`);

  let allocated: FloatingIp | undefined;
  const subnetsToTry = targetSubnets.length > 0 ? targetSubnets : [undefined];

  for (const subnet of subnetsToTry) {
    const subnetId = typeof subnet === "object" ? subnet.id : undefined;
    const subnetCidr = typeof subnet === "object" ? subnet.cidr : "default";
    try {
      allocated = await allocateFloatingIp(client, floatingNetworkId, subnetId);
      await logLine(
        `Allocated IP ${allocated.floating_ip_address} (id: ${allocated.id})${allocated.subnet_id ? ` subnet: ${allocated.subnet_id}` : ""} (cidr: ${subnetCidr})`,
      );
      break;
    } catch (err) {
      if (isNoMoreIpsError(err)) {
        await logLine(
          `Subnet ${subnetId ?? "default"} (cidr: ${subnetCidr}) has no free IPs (409). Trying next target subnet...`,
        );
        continue;
      }
      throw err;
    }
  }

  if (!allocated) {
    await logLine("Failed to allocate IP in all target subnets (no free addresses).");
    return false;
  }

  if (isIpInTargetRange(allocated.floating_ip_address)) {
    await logLine(`IP ${allocated.floating_ip_address} is in target range, keeping it.`);
    return true;
  }

  await logLine(`IP ${allocated.floating_ip_address} is outside target ranges, deleting...`);
  await deleteFloatingIp(client, allocated.id);
  await logLine(`Deleted IP ${allocated.floating_ip_address} (id: ${allocated.id}).`);
  return false;
}

async function main() {
  try {
    const token =
      process.env.OS_TOKEN ||
      process.env.VK_TOKEN ||
      process.env.TOKEN ||
      process.env.OPENSTACK_TOKEN;

    if (!token) {
      console.error("Missing token. Set OS_TOKEN/VK_TOKEN/OPENSTACK_TOKEN environment variable.");
      process.exit(1);
    }

    const baseURL = process.env.VK_NEUTRON_URL || "https://infra.mail.ru:9696";
    const client = createClient(token, baseURL);

    await logLine(`Starting watcher. Base URL: ${baseURL}`);

    const floatingNetworkId = await determineFloatingNetworkId(client);
    if (!floatingNetworkId) {
      console.error("Could not determine floating network id. Set FLOATING_NETWORK_ID env var.");
      process.exit(1);
    }

    const targetSubnets = await pickTargetSubnets(client);
    await logLine(
      targetSubnets.length > 0
        ? `Target subnets for allocation (shuffled order): ${targetSubnets
          .map((s) => `${s.id} (${s.cidr})`)
          .join(", ")}`
        : "No target subnet found in project; will allocate without explicit subnet filter.",
    );

    await cleanupNonTargetFloatingIps(client);

    let iteration = 1;
    while (true) {
      try {
        const gotTarget = await handleIteration(client, floatingNetworkId, targetSubnets, iteration);
        if (gotTarget) {
          await logLine("Successfully acquired a target-range IP. Continue watching for more or stop manually.");
        }
      } catch (iterationError) {
        await logLine(`Iteration ${iteration} failed: ${describeAxiosError(iterationError)}`);
      }

      const pause = randomPauseMs();
      await logLine(`Sleeping for ${Math.round(pause / 1000)} seconds before next attempt...`);
      await sleep(pause);
      iteration += 1;
    }
  } catch (err) {
    const error = err as Error;
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

void main();
