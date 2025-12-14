export type CloudCredentials = {
  id: string;
  name: string;
  type?: "yandex";
  folderId?: string;
  zoneId?: string;
  targetCidrs?: string[];
  maxAddresses?: number;
  labelKey?: string;
  labelValue?: string;
  keyContent?: string;
  /** legacy optional token support */
  token?: string;
  saName?: string;
  saDescription?: string;
  saRoles?: string[];
};

export type VmEntry = {
  id: string;
  ip: string;
  cloud: "yandex";
  accountId?: string;
  pingTimeoutMs?: number;
  pingIntervalMs?: number;
  monitorMethod?: "ping" | "api";
  name?: string;
  description?: string;
  status?: string;
  statusFetchedAt?: number;
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

export type IpEntry = {
  id: string;
  address: string;
  accountId?: string;
  zoneId?: string;
  assignedTo?: { vmId?: string; vmName?: string };
  deletionProtection?: boolean;
  status?: string;
  description?: string;
};

export type JobConfig = {
  id: string;
  kind: "ip-requestor-yc" | "ip-requestor-vk" | "vm-monitor";
  name: string;
  enabled: boolean;
  autoStart: boolean;
  settings: Record<string, unknown>;
};

export type AppConfig = {
  ycAccounts?: CloudCredentials[];
  vk?: { token?: string };
  vms: VmEntry[];
  ips: IpEntry[];
  jobs: JobConfig[];
};

export type JobStatus = "idle" | "running" | "paused" | "stopped" | "error";

export type JobRuntimeInfo = {
  id: string;
  status: JobStatus;
  lastError?: string;
  startedAt?: number;
  updatedAt?: number;
};
