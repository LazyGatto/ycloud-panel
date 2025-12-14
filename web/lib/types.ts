export type Account = {
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
  saName?: string;
  saDescription?: string;
  saRoles?: string[];
};

export type VmDetails = {
  cores?: number;
  coreFraction?: number;
  memoryBytes?: number;
  preemptible?: boolean;
  platformId?: string;
  internalIp?: string;
  publicIp?: string;
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
  details?: VmDetails;
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
  kind: "ip-requestor-yc" | "vm-monitor";
  name: string;
  enabled: boolean;
  autoStart: boolean;
  settings: Record<string, unknown>;
};

export type JobStatus = "idle" | "running" | "paused" | "stopped" | "error";

export type JobRuntimeInfo = {
  id: string;
  status: JobStatus;
  lastError?: string;
  startedAt?: number;
  updatedAt?: number;
};

export type AppConfig = {
  ycAccounts: Account[];
  vms: VmEntry[];
  ips: IpEntry[];
  jobs: JobConfig[];
};

export type LogRecord = {
  id: number;
  jobId: string;
  level: string;
  message: string;
  createdAt: number;
};
