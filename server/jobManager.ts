import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import { addLog, listLogs, setJobStatus, getJobStatuses } from "./logStore";
import { AppConfig, CloudCredentials, JobConfig, JobRuntimeInfo, JobStatus } from "./types";
import { runAddressWatcher } from "../src/yc/features/addressWatcher";
import { runVmMonitor } from "../src/yc/features/vmMonitor";
import { createClient } from "../src/yc/core/http";
import { getIamToken } from "../src/yc/core/auth";
import { addLogListener, removeLogListener } from "../src/yc/core/logger";

type Runtime = {
  status: JobStatus;
  controller?: AbortController;
  proc?: ChildProcessWithoutNullStreams;
  listener?: (line: string) => void;
  lastError?: string;
  startedAt?: number;
  updatedAt?: number;
  heartbeat?: NodeJS.Timeout;
};

// Persist job state across module reloads in dev.
const globalObj = global as unknown as { __jobState?: Map<string, Runtime> };
const jobState: Map<string, Runtime> = globalObj.__jobState ?? new Map<string, Runtime>();
if (!globalObj.__jobState) {
  globalObj.__jobState = jobState;
}

function resolveKeyPath(accountId?: string): string {
  const suffix = accountId ? `authorized_key-${accountId}.json` : "authorized_key.json";
  return path.resolve(process.cwd(), "data", suffix);
}

function updateRuntime(id: string, partial: Partial<Runtime>) {
  const current = jobState.get(id) ?? { status: "idle" as JobStatus };
  const next: Runtime = { ...current, ...partial, updatedAt: Date.now() };
  jobState.set(id, next);
  setJobStatus(id, next.status, next.lastError, next.startedAt, next.updatedAt);
}

export function listJobStatuses(): JobRuntimeInfo[] {
  const runtime = Array.from(jobState.entries()).map(([id, state]) => ({
    id,
    status: state.status,
    lastError: state.lastError,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  }));
  const persisted = getJobStatuses();
  const merged = new Map<string, JobRuntimeInfo>();
  for (const st of persisted) {
    merged.set(st.id, {
      id: st.id,
      status: st.status as JobStatus,
      lastError: st.lastError,
      startedAt: st.startedAt,
      updatedAt: st.updatedAt,
    });
  }
  for (const st of runtime) {
    merged.set(st.id, st);
  }
  const now = Date.now();
  return Array.from(merged.values()).map((st) => {
    // Если рантайма нет в памяти, считаем задачу не активной.
    if (!jobState.has(st.id)) {
      return { ...st, status: "idle" as JobStatus };
    }
    // Без свежего обновления переводим в idle, чтобы не залипало в "running".
    if (st.status === "running" && st.updatedAt && now - st.updatedAt > 30_000) {
      return { ...st, status: "idle" as JobStatus };
    }
    return { ...st, status: st.status as JobStatus };
  });
}

function attachLogger(jobId: string): (line: string) => void {
  const listener = (line: string) => addLog(jobId, "info", line);
  addLogListener(listener);
  return listener;
}

function detachLogger(listener?: (line: string) => void) {
  if (listener) removeLogListener(listener);
}

function pickYcAccount(config: AppConfig, accountId?: string): CloudCredentials | undefined {
  const accounts = config.ycAccounts ?? [];
  if (accountId) {
    const found = accounts.find((a) => a.id === accountId);
    if (found) return found;
  }
  if (accounts.length > 0) return accounts[0];
  return undefined;
}

async function startYcIpRequestor(job: JobConfig, config: AppConfig, controller: AbortController): Promise<void> {
  const yc = pickYcAccount(config, job.settings?.accountId as string | undefined);
  if (!yc?.folderId || !yc?.zoneId) {
    throw new Error("YC folderId/zoneId missing in config");
  }
  const keyPath = resolveKeyPath(yc.id);
  if (yc.keyContent) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, yc.keyContent, "utf8");
  }
  const iamToken = await getIamToken({
    keyFile: keyPath,
    iamUrl: process.env.YC_IAM_URL,
  });
  const vpcBase = process.env.YC_VPC_API || "https://vpc.api.cloud.yandex.net/vpc/v1";
  const opBase = process.env.YC_OPERATION_API || "https://operation.api.cloud.yandex.net/operations";
  const vpcClient = createClient(vpcBase, iamToken);
  const opClient = createClient(opBase, iamToken);

  const maxAddresses = yc.maxAddresses ?? Number(process.env.YC_MAX_ADDRESSES ?? "2");
  const targetCidrs = yc.targetCidrs ?? (process.env.YC_TARGET_CIDRS?.split(",").map((c) => c.trim()).filter(Boolean) ?? []);

  await runAddressWatcher({
    vpcClient,
    operationsClient: opClient,
    folderId: yc.folderId,
    zoneId: yc.zoneId,
    labelKey: yc.labelKey ?? "owner",
    labelValue: yc.labelValue ?? "vk-cloud-watcher",
    maxAddresses,
    targetCidrs,
    signal: controller.signal,
  });
}

async function startYcVmMonitor(job: JobConfig, config: AppConfig, controller: AbortController): Promise<void> {
  const vmId = (job.settings?.vmId as string) || (config.vms[0]?.id ?? "");
  const vmIp = (job.settings?.vmIp as string) || (config.vms[0]?.ip ?? "");
  const accountId = job.settings?.accountId as string | undefined;
  const monitorMethod = (job.settings?.monitorMethod as "ping" | "api") ?? "ping";
  if (!vmId) throw new Error("VM id not provided");
  if (monitorMethod === "ping" && !vmIp) throw new Error("VM ip not provided for ping mode");
  const yc = pickYcAccount(config, accountId);
  if (!yc?.folderId || !yc?.zoneId) {
    throw new Error("YC folderId/zoneId missing in config");
  }
  const keyPath = resolveKeyPath(yc.id);
  if (yc.keyContent) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, yc.keyContent, "utf8");
  }
  const computeBase = process.env.YC_COMPUTE_API || "https://compute.api.cloud.yandex.net/compute/v1";
  const opBase = process.env.YC_OPERATION_API || "https://operation.api.cloud.yandex.net/operations";
  const timeout = (job.settings?.pingTimeoutMs as number) || Number(process.env.YC_VM_PING_TIMEOUT_MS ?? "45000");
  const interval = (job.settings?.pingIntervalMs as number) || Number(process.env.YC_VM_PING_INTERVAL_MS ?? "120000");

  await runVmMonitor({
    computeBase,
    operationsBase: opBase,
    keyPath,
    iamUrl: process.env.YC_IAM_URL,
    vmId,
    vmIp,
    pingTimeoutMs: timeout,
    pingIntervalMs: interval,
    mode: monitorMethod,
    signal: controller.signal,
  });
}

async function startVkIpRequestor(job: JobConfig, config: AppConfig, controller: AbortController): Promise<void> {
  // Use existing CLI script via child process for now.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VK_TOKEN: config.vk?.token ?? "",
    VK_NEUTRON_URL: process.env.VK_NEUTRON_URL ?? "https://infra.mail.ru:9696",
  };
  const child = spawn("npx", ["ts-node", "src/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;
  updateRuntime(job.id, { proc: child });
  child.stdout.on("data", (buf) => addLog(job.id, "info", buf.toString().trim()));
  child.stderr.on("data", (buf) => addLog(job.id, "error", buf.toString().trim()));
  const onAbort = () => child.kill("SIGTERM");
  controller.signal.addEventListener("abort", onAbort, { once: true });
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      controller.signal.removeEventListener("abort", onAbort);
      if (code === 0 || controller.signal.aborted) resolve();
      else reject(new Error(`VK IP requestor exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function runJob(job: JobConfig, config: AppConfig, controller: AbortController): Promise<void> {
  switch (job.kind) {
    case "ip-requestor-yc":
      return startYcIpRequestor(job, config, controller);
    case "ip-requestor-vk":
      return startVkIpRequestor(job, config, controller);
    case "vm-monitor":
      return startYcVmMonitor(job, config, controller);
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

export async function startJob(job: JobConfig, config: AppConfig): Promise<void> {
  const current = jobState.get(job.id);
  if (current?.status === "running") return;
  const controller = new AbortController();
  const listener = attachLogger(job.id);
  updateRuntime(job.id, { status: "running", controller, listener, startedAt: Date.now(), lastError: undefined });
  const hb = setInterval(() => updateRuntime(job.id, { status: "running" }), 5_000);
  updateRuntime(job.id, { heartbeat: hb });
  addLog(job.id, "info", `Starting job ${job.name} (${job.kind})`);
  try {
    await runJob(job, config, controller);
    updateRuntime(job.id, { status: controller.signal.aborted ? "stopped" : "idle" });
  } catch (err) {
    const msg = (err as Error).message;
    addLog(job.id, "error", msg);
    updateRuntime(job.id, { status: "error", lastError: msg });
  } finally {
    const runtime = jobState.get(job.id);
    if (runtime?.heartbeat) clearInterval(runtime.heartbeat);
    updateRuntime(job.id, { heartbeat: undefined });
    detachLogger(listener);
  }
}

export function stopJob(jobId: string): void {
  const state = jobState.get(jobId);
  if (!state) return;
  if (state.controller && !state.controller.signal.aborted) {
    state.controller.abort();
  }
  if (state.proc) {
    state.proc.kill("SIGTERM");
  }
  if (state.heartbeat) clearInterval(state.heartbeat);
  updateRuntime(jobId, { status: "stopped", heartbeat: undefined });
}

export function pauseJob(jobId: string): void {
  stopJob(jobId);
  updateRuntime(jobId, { status: "paused" });
}

export function clearJobRuntime(jobId: string): void {
  jobState.delete(jobId);
}

export { addLog, listLogs };
