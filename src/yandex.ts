import { createClient, describeAxiosError } from "./yc/core/http";
import { getIamToken } from "./yc/core/auth";
import { logLine } from "./yc/core/logger";
import { runAddressWatcher } from "./yc/features/addressWatcher";
import { runVmMonitor } from "./yc/features/vmMonitor";

const TARGET_CIDRS = (process.env.YC_TARGET_CIDRS ?? "178.154.192.0/18")
  .split(",")
  .map((cidr) => cidr.trim())
  .filter(Boolean);
async function main() {
  try {
    const folderId = process.env.YC_FOLDER_ID;
    const zoneId = process.env.YC_ZONE_ID;
    const labelKey = process.env.YC_LABEL_KEY || "owner";
    const labelValue = process.env.YC_LABEL_VALUE || "vk-cloud-watcher";
    const maxAddressesEnv = process.env.YC_MAX_ADDRESSES ?? "2";
    const maxAddresses = Number.parseInt(maxAddressesEnv, 10);
    const vmId = process.env.YC_VM_ID;
    const vmIp = process.env.YC_VM_IP;
    const pingTimeoutMs = Number.parseInt(process.env.YC_VM_PING_TIMEOUT_MS ?? "3000", 10);
    const pingIntervalMs = Number.parseInt(process.env.YC_VM_PING_INTERVAL_MS ?? "10000", 10);

    if (!folderId) {
      console.error("YC_FOLDER_ID is required.");
      process.exit(1);
    }
    if (!zoneId) {
      console.error("YC_ZONE_ID is required to allocate external IPv4 addresses.");
      process.exit(1);
    }
    if (Number.isNaN(maxAddresses) || maxAddresses <= 0) {
      console.error("YC_MAX_ADDRESSES must be a positive integer.");
      process.exit(1);
    }
    if (Number.isNaN(pingTimeoutMs) || pingTimeoutMs <= 0) {
      console.error("YC_VM_PING_TIMEOUT_MS must be a positive integer.");
      process.exit(1);
    }
    if (Number.isNaN(pingIntervalMs) || pingIntervalMs <= 0) {
      console.error("YC_VM_PING_INTERVAL_MS must be a positive integer.");
      process.exit(1);
    }

    const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
    const operationBase = process.env.YC_OPERATION_API || "https://operation.api.cloud.yandex.net/operations";
    const computeBase = process.env.YC_COMPUTE_API || "https://compute.api.cloud.yandex.net/compute/v1";
    const runMode = (process.env.YC_RUN_MODE || "both").toLowerCase();
    const runWatcher = runMode === "both" || runMode === "watcher";
    const runMonitor = runMode === "both" || runMode === "monitor";

    const iamToken = await getIamToken({
      iamToken: process.env.YC_IAM_TOKEN,
      keyFile: process.env.YC_KEY_FILE,
      iamUrl: process.env.YC_IAM_URL,
    });
    const vpcClient = createClient(vpcBase, iamToken);
    const operationsClient = createClient(operationBase, iamToken);
    const computeClient = createClient(computeBase, iamToken);

    await logLine(
      `Starting Yandex Cloud watcher. VPC API: ${vpcBase} Operation API: ${operationBase} Compute API: ${computeBase} Folder: ${folderId} Zone: ${zoneId}`,
    );
    await logLine(`Target CIDRs: ${TARGET_CIDRS.join(", ")} | Max addresses allowed: ${maxAddresses}`);

    const tasks: Promise<void>[] = [];
    if (runWatcher) {
      tasks.push(
        runAddressWatcher({
          vpcClient,
          operationsClient,
          folderId,
          zoneId,
          labelKey,
          labelValue,
          maxAddresses,
          targetCidrs: TARGET_CIDRS,
        }),
      );
    } else {
      await logLine("Address watcher disabled by YC_RUN_MODE.");
    }

    if (runMonitor && vmId && vmIp) {
      tasks.push(
        runVmMonitor({
          computeClient,
          operationsClient,
          vmId,
          vmIp,
          pingTimeoutMs,
          pingIntervalMs,
        }),
      );
    } else if (runMonitor) {
      await logLine("VM monitor not started (YC_VM_ID or YC_VM_IP is missing).");
    } else {
      await logLine("VM monitor disabled by YC_RUN_MODE.");
    }

    await Promise.all(tasks);
  } catch (err) {
    const error = err as Error;
    const reason = describeAxiosError(error);
    console.error(`Fatal error: ${reason}`);
    process.exit(1);
  }
}

void main();
