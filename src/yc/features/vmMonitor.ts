import axios, { AxiosInstance } from "axios";
import { logLine } from "../core/logger";
import { pingHost } from "../core/ping";
import { describeAxiosError } from "../core/http";
import { getInstance, startInstance } from "../services/compute";
import { getIamToken } from "../core/auth";
import { createClient } from "../core/http";
import { sleep } from "../core/utils";

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort);
  });
}

export async function runVmMonitor(options: {
  computeBase: string;
  operationsBase: string;
  iamUrl?: string;
  keyPath: string;
  vmId: string;
  vmIp: string;
  pingTimeoutMs: number;
  pingIntervalMs: number;
  mode?: "ping" | "api";
  signal?: AbortSignal;
}): Promise<void> {
  const { computeBase, operationsBase, iamUrl, keyPath, vmId, vmIp, pingTimeoutMs, pingIntervalMs, mode = "ping", signal } =
    options;

  const buildClients = async (): Promise<{ computeClient: AxiosInstance; operationsClient: AxiosInstance }> => {
    const iamToken = await getIamToken({ keyFile: keyPath, iamUrl });
    return {
      computeClient: createClient(computeBase, iamToken),
      operationsClient: createClient(operationsBase, iamToken),
    };
  };

  let { computeClient, operationsClient } = await buildClients();

  const refreshClients = async () => {
    await logLine("Refreshing IAM token for VM monitor");
    const built = await buildClients();
    computeClient = built.computeClient;
    operationsClient = built.operationsClient;
  };
  await logLine(
    `Starting VM monitor for ${vmId} using ${mode}. Ping timeout: ${pingTimeoutMs}ms, interval: ${pingIntervalMs}ms`,
  );

  while (true) {
    if (signal?.aborted) {
      await logLine("VM monitor stopped by signal.");
      return;
    }
    try {
      const instance = await getInstance(computeClient, vmId);
      const status = instance.status ?? "UNKNOWN";
      if (mode === "ping") {
        const reachable = await pingHost(vmIp, pingTimeoutMs);
        if (reachable) {
          await logLine(`Ping OK for ${vmIp}`);
          await sleepAbortable(pingIntervalMs, signal);
          continue;
        }
        await logLine(`Ping FAILED for ${vmIp}, checking instance status...`);
      } else {
        await logLine(`Instance ${vmId} status: ${status}`);
      }

      const shouldStart =
        status === "STOPPED" || status === "STOPPING" || status === "STOPPING_DOWN" || (mode === "api" && status !== "RUNNING");

      if (shouldStart) {
        try {
          await logLine(`Instance ${vmId} is not running. Sending start command...`);
          await startInstance(computeClient, operationsClient, vmId);
          await logLine(`Start command completed for ${vmId}.`);
        } catch (startErr) {
          await logLine(`Failed to start instance ${vmId}: ${describeAxiosError(startErr)}`);
        }
      } else {
        await logLine(`Instance ${vmId} status=${status}, no action.`);
      }
    } catch (err) {
      const axiosErr = axios.isAxiosError(err) ? err : undefined;
      const isAuthError = axiosErr?.response?.status === 401;
      if (isAuthError) {
        await logLine(`Auth failed for ${vmId}, refreshing token...`);
        try {
          await refreshClients();
          continue;
        } catch (refreshErr) {
          await logLine(`Failed to refresh token: ${describeAxiosError(refreshErr)}`);
        }
      }
      await logLine(`Failed to fetch instance ${vmId}: ${describeAxiosError(err)}`);
    }

    await sleepAbortable(pingIntervalMs, signal);
  }
}
