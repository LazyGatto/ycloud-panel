import { AxiosInstance } from "axios";
import { Address, allocateAddress, deleteAddress, listAddresses } from "../services/vpc";
import { isIpInRanges } from "../core/ip";
import { logLine } from "../core/logger";
import { describeAxiosError } from "../core/http";
import { randomDelayMs, sleep } from "../core/utils";

function getAddressIp(addr: Address): string | undefined {
  return addr.externalIpv4Address?.address;
}

function isManagedByUs(addr: Address, labelKey?: string, labelValue?: string): boolean {
  if (!labelKey || !labelValue) return true;
  return addr.labels?.[labelKey] === labelValue;
}

async function cleanupNonTargetAddresses(
  vpcClient: AxiosInstance,
  operationsClient: AxiosInstance,
  folderId: string,
  targetCidrs: string[],
  labelKey?: string,
  labelValue?: string,
): Promise<void> {
  const addresses = await listAddresses(vpcClient, folderId);
  const candidates = addresses.filter((addr) => {
    const ip = getAddressIp(addr);
    return ip && isManagedByUs(addr, labelKey, labelValue) && !isIpInRanges(ip, targetCidrs);
  });
  if (candidates.length === 0) {
    await logLine("No non-target addresses to clean up.");
    return;
  }
  await logLine(
    `Cleaning up ${candidates.length} non-target address(es): ${candidates
      .map((a) => `${getAddressIp(a) ?? "unknown"} (${a.id})`)
      .join(", ")}`,
  );
  for (const addr of candidates) {
    const ip = getAddressIp(addr) ?? "unknown";
    try {
      await deleteAddress(vpcClient, operationsClient, addr.id, ip);
      await logLine(`Deleted non-target address ${ip} (${addr.id}).`);
    } catch (err) {
      await logLine(`Failed to delete address ${ip} (${addr.id}): ${describeAxiosError(err)}`);
    }
  }
}

export async function runAddressWatcher(options: {
  vpcClient: AxiosInstance;
  operationsClient: AxiosInstance;
  folderId: string;
  zoneId: string;
  labelKey?: string;
  labelValue?: string;
  maxAddresses: number;
  targetCidrs: string[];
  signal?: AbortSignal;
}): Promise<void> {
  const { vpcClient, operationsClient, folderId, zoneId, labelKey, labelValue, maxAddresses, targetCidrs, signal } =
    options;

  await cleanupNonTargetAddresses(vpcClient, operationsClient, folderId, targetCidrs, labelKey, labelValue);

  let iteration = 1;
  while (true) {
    if (signal?.aborted) {
      await logLine("Address watcher stopped by signal.");
      return;
    }

    const existing = await listAddresses(vpcClient, folderId);
    const totalExisting = existing.length;
    const summary =
      existing
        .map((addr) => `${getAddressIp(addr) ?? "no-ip"}${addr.reserved ? " [reserved]" : ""}`)
        .join(", ") || "none";
    await logLine(
      `Iteration ${iteration}: existing addresses (${totalExisting}/${maxAddresses}) -> ${summary}`,
    );

    const capacity = Math.max(0, maxAddresses - totalExisting);
    if (capacity <= 0) {
      const waitMs = randomDelayMs(10_000, 30_000);
      await logLine(
        `Capacity reached (${totalExisting}/${maxAddresses}). Sleeping ${Math.round(waitMs / 1000)}s before retry...`,
      );
      await sleep(waitMs);
      iteration += 1;
      continue;
    }

    const toAllocate = Math.min(2, capacity);
    await logLine(`Requesting ${toAllocate} address(es) this iteration...`);
    const batch: Address[] = [];

    for (let i = 0; i < toAllocate; i += 1) {
      try {
        const addr = await allocateAddress(vpcClient, operationsClient, folderId, zoneId, labelKey, labelValue);
        batch.push(addr);
        await logLine(
          `Allocated [${i + 1}/${toAllocate}] ${getAddressIp(addr) ?? "unknown"} (id: ${addr.id}) zone: ${addr.externalIpv4Address?.zoneId ?? "unknown"}`,
        );
      } catch (err) {
        await logLine(`Allocation ${i + 1}/${toAllocate} failed: ${describeAxiosError(err)}`);
      }
    }

    if (batch.length === 0) {
      const waitMs = randomDelayMs(10_000, 30_000);
      await logLine(`No addresses allocated this iteration. Sleeping ${Math.round(waitMs / 1000)}s before retry...`);
      await sleep(waitMs);
      iteration += 1;
      continue;
    }

    const targetAddrs = batch.filter((addr) => {
      const ip = getAddressIp(addr);
      return ip !== undefined && isIpInRanges(ip, targetCidrs);
    });
    const nonTargetAddrs = batch.filter((addr) => !targetAddrs.includes(addr));

    if (targetAddrs.length > 0) {
      await logLine(
        `Success: ${targetAddrs.length} target address(es) acquired: ${targetAddrs
          .map((a) => `${getAddressIp(a) ?? "unknown"} (${a.id})`)
          .join(", ")}`,
      );
      if (nonTargetAddrs.length > 0) {
        await logLine(
          `Cleaning up ${nonTargetAddrs.length} non-target address(es) from the batch: ${nonTargetAddrs
            .map((a) => `${getAddressIp(a) ?? "unknown"} (${a.id})`)
            .join(", ")}`,
        );
        for (const addr of nonTargetAddrs) {
          const ip = getAddressIp(addr) ?? "unknown";
          try {
            await deleteAddress(vpcClient, operationsClient, addr.id, ip);
            await logLine(`Deleted non-target batch address ${ip} (${addr.id}).`);
          } catch (err) {
            await logLine(`Failed to delete batch address ${ip} (${addr.id}): ${describeAxiosError(err)}`);
          }
        }
      }
      const waitMs = randomDelayMs(10_000, 30_000);
      await logLine(`Sleeping ${Math.round(waitMs / 1000)}s before next iteration...`);
      await sleep(waitMs);
      iteration += 1;
      continue;
    }

    const waitBeforeDelete = randomDelayMs(5_000, 15_000);
    await logLine(
      `No target addresses in batch. Waiting ${Math.round(waitBeforeDelete / 1000)}s before deleting allocated addresses...`,
    );
    await sleep(waitBeforeDelete);

    for (const addr of batch) {
      const ip = getAddressIp(addr) ?? "unknown";
      try {
        await deleteAddress(vpcClient, operationsClient, addr.id, ip);
        await logLine(`Deleted non-target batch address ${ip} (${addr.id}).`);
      } catch (err) {
        await logLine(`Failed to delete batch address ${ip} (${addr.id}): ${describeAxiosError(err)}`);
      }
    }

    const waitRetry = randomDelayMs(10_000, 30_000);
    await logLine(`Sleeping ${Math.round(waitRetry / 1000)}s before retrying allocation...`);
    await sleep(waitRetry);
    iteration += 1;
  }
}
