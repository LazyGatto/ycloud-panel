import fs from "fs";
import path from "path";
import { AppConfig, JobConfig } from "./types";
import { randomUUID } from "crypto";

const DEFAULT_CONFIG: AppConfig = {
  ycAccounts: [],
  vms: [],
  ips: [],
  jobs: [],
};

function ensureJobs(cfg: AppConfig): AppConfig {
  const vmIds = new Set((cfg.vms ?? []).map((v) => v.id));
  const jobs: JobConfig[] = [...(cfg.jobs ?? [])].filter(
    (j) => j.kind !== "vm-monitor" || (vmIds.size > 0 && vmIds.has((j.settings as any)?.vmId as string)),
  );

  const ensureJob = (template: JobConfig) => {
    const existing = jobs.find((j) => j.id === template.id);
    if (!existing) {
      jobs.push(template);
    }
  };

  ensureJob({
    id: "ip-requestor-yc",
    kind: "ip-requestor-yc",
    name: "IP Requestor (Yandex)",
    enabled: true,
    autoStart: false,
    settings: {},
  });

  // One VM monitor job per VM
  for (const vm of cfg.vms ?? []) {
    const jobId = `vm-monitor-${vm.id}`;
    ensureJob({
      id: jobId,
      kind: "vm-monitor",
      name: `VM Monitor ${vm.name ?? vm.id}`,
      enabled: true,
      autoStart: false,
      settings: {
        vmId: vm.id,
        vmIp: vm.ip ?? vm.details?.publicIp,
        accountId: vm.accountId,
        pingTimeoutMs: vm.pingTimeoutMs,
        pingIntervalMs: vm.pingIntervalMs,
        monitorMethod: vm.monitorMethod ?? "ping",
      },
    });
  }

  return { ...cfg, jobs };
}

function normalizeAccounts(cfg: AppConfig): AppConfig {
  const withDefaults = { ...cfg };
  withDefaults.ycAccounts = (cfg.ycAccounts ?? []).map((acc, idx) => ({
    ...acc,
    id: acc.id || randomUUID(),
    name: acc.name || `Yandex ${idx + 1}`,
    type: "yandex",
  }));
  return withDefaults;
}

function getConfigPath(): string {
  const custom = process.env.CONFIG_PATH;
  const resolved = custom ? path.resolve(custom) : path.resolve(process.cwd(), "data", "config.json");
  return resolved;
}

export async function loadConfig(): Promise<AppConfig> {
  const cfgPath = getConfigPath();
  try {
    const raw = await fs.promises.readFile(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as AppConfig;
    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      vms: parsed.vms ?? [],
      ips: parsed.ips ?? [],
      jobs: parsed.jobs ?? [],
      ycAccounts: parsed.ycAccounts ?? [],
    };
    return ensureJobs(normalizeAccounts(merged));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const cfg = ensureJobs(DEFAULT_CONFIG);
      await saveConfig(cfg);
      return cfg;
    }
    throw err;
  }
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const cfgPath = getConfigPath();
  await fs.promises.mkdir(path.dirname(cfgPath), { recursive: true });
  const normalized: AppConfig = ensureJobs(
    normalizeAccounts({
      ycAccounts: config.ycAccounts ?? [],
      vms: config.vms ?? [],
      ips: config.ips ?? [],
      jobs: config.jobs ?? [],
    }),
  );
  await fs.promises.writeFile(cfgPath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function mergeJobConfig(existing: JobConfig[], updates: JobConfig[]): JobConfig[] {
  const map = new Map(existing.map((j) => [j.id, j]));
  for (const job of updates) {
    map.set(job.id, job);
  }
  return Array.from(map.values());
}
