"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  AppShell,
  Button,
  Burger,
  Card,
  Modal,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  Divider,
  Badge,
  ScrollArea,
  ActionIcon,
  Tooltip,
  NavLink,
  Select,
  Checkbox,
  NumberInput,
  LoadingOverlay,
  Box,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconTrash,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconSun,
  IconMoon,
  IconLanguageHiragana,
  IconSettings,
  IconListDetails,
  IconTopologyStar,
  IconListCheck,
  IconRefresh,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { t } from "../lib/i18n";
import { useUISettings } from "./providers";
import { AccountModal, type AccountForm } from "../components/AccountModal";
import { AccountsSection } from "../components/AccountsSection";
import { IpSection, type NewIpState } from "../components/IpSection";
import { VmSection, type VmActions } from "../components/VmSection";
import type { Account, AppConfig, IpEntry, JobConfig, JobRuntimeInfo, JobStatus, LogRecord, VmEntry } from "../lib/types";
import type { IpAllocLog } from "../components/IpSection";

function Page() {
  const { colorScheme, setColorScheme, lang, setLang } = useUISettings();
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [navOpened, setNavOpened] = useState(true);
  const [activeSection, setActiveSection] = useState<"settings" | "ips" | "vms" | "logs">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("ui-section");
      if (stored === "settings" || stored === "ips" || stored === "vms" || stored === "logs") {
        return stored as "settings" | "ips" | "vms" | "logs";
      }
    }
    return "settings";
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [statuses, setStatuses] = useState<JobRuntimeInfo[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const debug = process.env.NEXT_PUBLIC_DEBUG === "true";
  const DEFAULT_PING_TIMEOUT = "45000";
  const DEFAULT_PING_INTERVAL = "120000";
  const [newVm, setNewVm] = useState({
    id: "",
    accountId: "",
    pingTimeoutMs: DEFAULT_PING_TIMEOUT,
    pingIntervalMs: DEFAULT_PING_INTERVAL,
    monitorMethod: "ping",
    description: "",
  });
  const [addingVm, setAddingVm] = useState(false);
  const [editingVmId, setEditingVmId] = useState<string | null>(null);
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountForm | undefined>(undefined);
  const [logVmId, setLogVmId] = useState<string | null>(null);
  const [cidrs, setCidrs] = useState<string[]>([]);
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [newIp, setNewIp] = useState<NewIpState>({
    accountId: "",
    useTarget: false,
    useMask: false,
  targetCidrs: [] as string[],
  mask: "",
  attempts: 10,
  minDelayMs: 5000,
  maxDelayMs: 15000,
  });
  const [logModalEntries, setLogModalEntries] = useState<LogRecord[]>([]);
  const [logLimit, setLogLimit] = useState(40);
  const [logLoading, setLogLoading] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [allocRunning, setAllocRunning] = useState(false);
  const [allocLogs, setAllocLogs] = useState<IpAllocLog[]>([]);
  const [allocResult, setAllocResult] = useState<{ success: boolean; message: string; logs: IpAllocLog[] } | null>(null);
  const allocAbortRef = useRef(false);

  const withBusy = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusyCount((c) => c + 1);
    try {
      return await fn();
    } finally {
      setBusyCount((c) => Math.max(0, c - 1));
    }
  };
  function ipToLong(ip: string): number {
    return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  }
  function inCidr(ip: string, cidr: string): boolean {
    const [base, mask] = cidr.split("/");
    if (!base || !mask) return false;
    const bits = Number(mask);
    const ipL = ipToLong(ip);
    const baseL = ipToLong(base);
    const maskL = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipL & maskL) === (baseL & maskL);
  }

  const allAccounts: Account[] = config?.ycAccounts ?? [];
  const resolveAccount = (accountId?: string) => allAccounts.find((a) => a.id === accountId);

  const normalizeConfig = (cfg: Partial<AppConfig> | null | undefined): AppConfig => ({
    ycAccounts: cfg?.ycAccounts ?? [],
    vms: cfg?.vms ?? [],
    ips: cfg?.ips ?? [],
    jobs: cfg?.jobs ?? [],
  });

  async function persistConfig(nextConfig: AppConfig) {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    const data = await res.json();
    if (res.ok && data.config) {
      setConfig(normalizeConfig(data.config));
      notifications.show({ title: t("saved", lang), message: t("configHint", lang), color: "green" });
    } else {
      notifications.show({ title: t("error", lang), message: data.error ?? t("saveFail", lang), color: "red" });
    }
    if (debug) console.log("persist config", res.status, data);
  }

  function formatRelative(ts?: number) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const sec = Math.max(1, Math.floor(diff / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hours = Math.floor(min / 60);
    return `${hours}h`;
  }

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchCidrs = async () => {
      try {
        const res = await fetch("/api/cidrs");
        if (res.ok) {
          const data = await res.json();
          setCidrs(data.cidrs ?? []);
        }
      } catch {
        // ignore fetch errors
      }
    };
    fetchCidrs();
  }, []);

  useEffect(() => {
    if (logVmId) {
      loadVmLogs(logVmId, 40);
    } else {
      setLogModalEntries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logVmId]);

  useEffect(() => {
    if (!authed) return;
    loadJobs();
    const es = new EventSource("/api/jobs/stream");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as JobRuntimeInfo[];
        setStatuses(payload);
      } catch {
        // ignore
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);
  useEffect(() => {
    if (allAccounts.length > 0 && !allAccounts.find((a) => a.id === newVm.accountId)) {
      setNewVm((prev) => ({ ...prev, accountId: allAccounts[0]?.id ?? "" }));
    }
  }, [config, allAccounts, newVm.accountId]);

  useEffect(() => {
    const storedSection = typeof window !== "undefined" ? localStorage.getItem("ui-section") : null;
    if (storedSection === "logs" || storedSection === "settings" || storedSection === "ips" || storedSection === "vms") {
      setActiveSection(storedSection as "settings" | "ips" | "vms" | "logs");
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ui-section", activeSection);
    }
  }, [activeSection]);

  // Account handlers
  const handleAddAccount = () => {
    setEditingAccount(undefined);
    setAccountModalOpen(true);
  };

  const handleEditAccount = (acc: Account) => {
    setEditingAccount({
      id: acc.id,
      name: acc.name,
      type: "yandex",
      folderId: acc.folderId,
      zoneId: acc.zoneId,
      maxAddresses: acc.maxAddresses ? String(acc.maxAddresses) : "",
      keyContent: "",
      saName: acc.saName,
      saDescription: acc.saDescription,
      saRoles: acc.saRoles,
    });
    setAccountModalOpen(true);
  };

  const handleDeleteAccount = async (acc: Account) => {
    if (!config) return;
    if (!confirm(t("accountDeleteConfirm", lang))) return;
    const nextCfg: AppConfig = {
      ...config,
      ycAccounts: (config.ycAccounts ?? []).filter((a) => a.id !== acc.id),
      vms: (config.vms ?? []).filter((vm) => vm.accountId !== acc.id),
      ips: (config.ips ?? []).filter((ip) => ip.assignedTo?.vmId ? true : true),
      jobs: (config.jobs ?? []).filter((j) => {
        if (j.kind !== "vm-monitor") return true;
        const accountId = (j.settings as { accountId?: string } | undefined)?.accountId;
        return accountId !== acc.id;
      }),
    };
    await persistConfig(nextCfg);
  };

  // IP handlers
  const handleRefreshIps = async () =>
    withBusy(async () => {
      const res = await fetch("/api/ips/refresh");
      const data = await res.json();
      if (res.ok) {
        setConfig((cfg) => (cfg ? { ...cfg, ips: data.ips ?? [] } : cfg));
        notifications.show({ title: t("refresh", lang), message: t("ipUpdated", lang), color: "green" });
      } else {
        notifications.show({ title: t("error", lang), message: data.error ?? t("ipUpdateError", lang), color: "red" });
      }
    });

  const openIpModal = () => {
    const accounts = config?.ycAccounts ?? [];
    if (accounts.length === 0) {
      notifications.show({ title: t("error", lang), message: t("ipNoAccounts", lang), color: "red" });
      return;
    }
    const available = accounts.filter((a) => {
      const limit = a.maxAddresses ?? Number(process.env.NEXT_PUBLIC_YC_MAX_ADDRESSES ?? "2");
      const count = (config?.ips ?? []).filter((ip) => ip.accountId === a.id).length;
      return count < limit;
    });
    if (available.length === 0) {
      notifications.show({ title: t("error", lang), message: t("ipNoQuota", lang), color: "red" });
      return;
    }
    const defaultAcc = available[0];
    setNewIp((p) => {
      const current = p.accountId;
      const stillAvailable = available.some((a) => a.id === current);
      const nextAccountId = stillAvailable ? current : defaultAcc.id;
      return { ...p, accountId: nextAccountId };
    });
    setIpModalOpen(true);
  };

  const handleDeleteIp = async (id: string) => {
    await withBusy(async () => {
      const res = await fetch("/api/ips/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig((cfg) => (cfg ? { ...cfg, ips: data.ips ?? [] } : cfg));
        notifications.show({ title: t("saved", lang), message: t("ipDeleted", lang), color: "green" });
      } else {
        notifications.show({ title: t("error", lang), message: data.error ?? t("ipDeleteError", lang), color: "red" });
      }
    });
  };

  const handleAllocateIp = async () => {
    if (!newIp.accountId) {
      notifications.show({ title: t("error", lang), message: t("ipSelectAccount", lang), color: "red" });
      return;
    }
    const acc = resolveAccount(newIp.accountId);
    if (!acc) {
      notifications.show({ title: t("error", lang), message: t("ipAccountNotFound", lang), color: "red" });
      return;
    }
    const limit = acc.maxAddresses ?? Number(process.env.NEXT_PUBLIC_YC_MAX_ADDRESSES ?? "2");
    const count = (config?.ips ?? []).filter((ip) => ip.accountId === acc.id).length;
    if (count >= limit) {
      notifications.show({
        title: t("error", lang),
        message: t("ipLimitReached", lang).replace("{name}", acc.name).replace("{limit}", String(limit)),
        color: "red",
      });
      return;
    }
    if (newIp.useTarget) {
      const hasTarget = (!newIp.useMask && (newIp.targetCidrs?.length ?? 0) > 0) || !!newIp.mask?.trim();
      if (!hasTarget) {
        notifications.show({
          title: t("error", lang),
          message: t("ipNeedTarget", lang),
          color: "red",
        });
        return;
      }
      if (newIp.mask) {
        const maskOk = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.\*$/.test(newIp.mask.trim());
        if (!maskOk) {
          notifications.show({
            title: t("error", lang),
            message: t("ipMaskFormat", lang),
            color: "red",
          });
          return;
        }
        const baseIp = newIp.mask.trim().replace("*", "0");
        const allowed = cidrs.some((c) => inCidr(baseIp, c));
        if (!allowed) {
          notifications.show({
            title: t("error", lang),
            message: t("ipMaskNotAllowed", lang),
            color: "red",
          });
          return;
        }
      }
    }

    setAllocRunning(true);
    setAllocLogs([]);
    setAllocResult(null);
    allocAbortRef.current = false;

    const attempts = newIp.attempts || 1;
    let lastMessage = "";
    let logsAcc: IpAllocLog[] = [];
    for (let i = 1; i <= attempts; i++) {
      if (allocAbortRef.current) {
        lastMessage = t("ipAllocAborted", lang);
        logsAcc = [...logsAcc, { attempt: i, message: `${t("ipAttemptLabel", lang)} ${i}: ${t("ipAllocAborted", lang)}` }];
        setAllocLogs(logsAcc);
        break;
      }
      const logStart: IpAllocLog = {
        attempt: i,
        message: `${t("ipAttemptLabel", lang)} ${i}: ${t("ipAllocAttempt", lang)}`,
        ip: undefined,
      };
      logsAcc = [...logsAcc, logStart];
      setAllocLogs(logsAcc);
      try {
        const res = await fetch("/api/ips/allocate/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newIp, accountId: acc.id }),
        });
        const data = await res.json();
        if (res.ok && data.matched) {
          const ipAddr = data.ip as string | undefined;
          logsAcc = [
            ...logsAcc,
            {
              attempt: i,
              ip: ipAddr,
              matched: true,
              message: `${t("ipAttemptLabel", lang)} ${i}: ${t("ipAllocMatched", lang)}${ipAddr ? ` — ${ipAddr}` : ""}`,
            },
          ];
          setAllocLogs(logsAcc);
          setConfig((cfg) => (cfg ? { ...cfg, ips: data.ips ?? cfg.ips } : cfg));
          setAllocResult({ success: true, message: t("ipReceived", lang), logs: logsAcc });
          setAllocRunning(false);
          return;
        } else {
          const ipAddr = data.ip as string | undefined;
          const msg = data.error ?? data.message ?? t("ipAllocNotMatched", lang);
          lastMessage = msg;
          logsAcc = [
            ...logsAcc,
            {
              attempt: i,
              ip: ipAddr,
              matched: false,
              message: `${t("ipAttemptLabel", lang)} ${i}: ${t("ipAllocNotMatched", lang)}${ipAddr ? ` — ${ipAddr}` : ""}`,
            },
          ];
          setAllocLogs(logsAcc);
        }
      } catch (err) {
        const msg = (err as Error).message;
        lastMessage = msg;
        logsAcc = [...logsAcc, { attempt: i, matched: false, message: msg }];
        setAllocLogs(logsAcc);
      }
      if (i < attempts) {
        const delay = Math.floor(Math.random() * (Number(newIp.maxDelayMs) - Number(newIp.minDelayMs) + 1)) + Number(newIp.minDelayMs);
        logsAcc = [
          ...logsAcc,
          { attempt: i, message: `${t("ipAttemptLabel", lang)} ${i}: ${t("ipAllocDelay", lang)} ${delay}ms` },
        ];
        setAllocLogs(logsAcc);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    setAllocResult({ success: false, message: lastMessage || t("ipReceiveError", lang), logs: logsAcc });
    setAllocRunning(false);
  };

  async function checkAuth() {
    setLoading(true);
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      setAuthed(true);
      await loadConfig();
      await loadJobs();
      subscribeLogs();
    } else {
      setAuthed(false);
    }
    setLoading(false);
  }

  async function login() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      notifications.show({ title: t("loginOk", lang), message: t("sessionCreated", lang), color: "green" });
      await checkAuth();
    } else {
      notifications.show({ title: t("loginFail", lang), message: t("invalidCreds", lang), color: "red" });
    }
    if (debug) console.log("login attempt", res.status);
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      const normalized = normalizeConfig(data);
      setConfig(normalized);
      if (!newIp.accountId && normalized.ycAccounts.length > 0) {
        setNewIp((p) => ({ ...p, accountId: normalized.ycAccounts[0].id }));
      }
      if (debug) console.log("config loaded", data);
    }
  }

  async function loadJobs() {
    await withBusy(async () => {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
        setStatuses(data.statuses);
        if (debug) console.log("jobs loaded", data);
      }
    });
  }

  async function loadVmLogs(vmId: string, limit = 40) {
    setLogLoading(true);
    try {
      const res = await fetch(`/api/logging?jobId=vm-monitor-${vmId}&limit=${limit}`);
      const data = await res.json();
      if (res.ok) {
        setLogModalEntries(data.logs ?? []);
        setLogLimit(limit);
      }
    } finally {
      setLogLoading(false);
    }
  }

  async function jobAction(jobId: string, action: string) {
    await withBusy(async () => {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      if (res.ok) {
        notifications.show({ title: `${t("actionSent", lang)} ${action}`, message: jobId, color: "green" });
        await loadJobs();
      } else {
        notifications.show({ title: t("jobActionFail", lang), message: jobId, color: "red" });
      }
      if (debug) console.log("job action", action, jobId, res.status);
    });
  }

  async function refreshVms() {
    await withBusy(async () => {
      try {
        const res = await fetch("/api/vms/refresh");
        const data = await res.json();
        if (res.ok) {
          const vms: VmEntry[] = data.vms ?? [];
          const vmJobs: JobConfig[] = vms.map((vm) => ({
            id: `vm-monitor-${vm.id}`,
            kind: "vm-monitor",
            name: `VM Monitor ${vm.name ?? vm.id}`,
            enabled: true,
            autoStart: false,
            settings: {
              vmId: vm.id,
              vmIp: vm.details?.publicIp ?? vm.ip,
              accountId: vm.accountId,
              pingTimeoutMs: vm.pingTimeoutMs ?? Number(DEFAULT_PING_TIMEOUT),
              pingIntervalMs: vm.pingIntervalMs ?? Number(DEFAULT_PING_INTERVAL),
              monitorMethod: vm.monitorMethod ?? "api",
            },
          }));
          setConfig((cfg) =>
            cfg
              ? {
                  ...cfg,
                  vms,
                  jobs: [...(cfg.jobs ?? []).filter((j) => !j.id.startsWith("vm-monitor-")), ...vmJobs],
                }
              : { ycAccounts: [], ips: [], vms, jobs: vmJobs },
          );
          notifications.show({ title: t("refresh", lang), message: t("vmsRefreshed", lang), color: "green" });
        } else {
          notifications.show({ title: t("error", lang), message: data.error ?? t("vmRefreshError", lang), color: "red" });
        }
      } catch (err) {
        notifications.show({ title: t("error", lang), message: (err as Error).message ?? t("vmRefreshError", lang), color: "red" });
      }
    });
  }

  const handleDeleteVm = async (vmId: string) => {
    if (!config) return;
    await withBusy(async () => {
      const nextCfg: AppConfig = {
        ...config,
        vms: (config.vms ?? []).filter((v) => v.id !== vmId),
        jobs: (config.jobs ?? []).filter((j) => j.id !== `vm-monitor-${vmId}`),
      };
      await persistConfig(nextCfg);
    });
  };

  const handleEditVm = (vm: VmEntry) => {
    const acc = resolveAccount(vm.accountId);
    if (!acc) {
      notifications.show({
        title: t("error", lang),
        message: t("vmAccountRequired", lang),
        color: "red",
      });
      return;
    }
    setNewVm({
      id: vm.id,
      accountId: acc.id,
      pingTimeoutMs: String(vm.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT),
      pingIntervalMs: String(vm.pingIntervalMs ?? DEFAULT_PING_INTERVAL),
      monitorMethod: vm.monitorMethod ?? "ping",
      description: vm.description ?? "",
    });
    setEditingVmId(vm.id);
    setVmModalOpen(true);
  };

  const handleRefreshVmSingle = async (vm: VmEntry, account: Account) => {
    await withBusy(async () => {
      try {
        const res = await fetch("/api/vm/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: vm.id,
            cloud: account.type ?? vm.cloud ?? "yandex",
            accountId: account.id,
          }),
        });
        const data = await res.json();
        if (res.ok && data.vm) {
          const refreshed: VmEntry = {
            ...vm,
            ...data.vm,
            statusFetchedAt: Date.now(),
          };
          const base: AppConfig = config ?? { ycAccounts: [], ips: [], vms: [], jobs: [] };
          const nextCfg: AppConfig = {
            ...base,
            vms: (base.vms ?? []).map((item) => (item.id === vm.id ? refreshed : item)),
            jobs: (base.jobs ?? []).map((j) =>
              j.id === `vm-monitor-${vm.id}`
                ? {
                    ...j,
                    settings: {
                      ...(j.settings ?? {}),
                      vmId: vm.id,
                      vmIp: refreshed.details?.publicIp ?? refreshed.ip,
                      accountId: account.id,
                      pingTimeoutMs: refreshed.pingTimeoutMs,
                      pingIntervalMs: refreshed.pingIntervalMs,
                    },
                  }
                : j,
            ),
          };
          await persistConfig(nextCfg);
        } else {
          notifications.show({
            title: t("error", lang),
            message: data.error ?? "Failed",
            color: "red",
          });
        }
      } catch (err) {
        notifications.show({ title: t("error", lang), message: (err as Error).message, color: "red" });
      }
    });
  };

  const vmActions: VmActions = {
    onAdd: () => {
      setNewVm({
        id: "",
        accountId: config?.ycAccounts?.[0]?.id ?? "",
        pingTimeoutMs: DEFAULT_PING_TIMEOUT,
        pingIntervalMs: DEFAULT_PING_INTERVAL,
        monitorMethod: "ping",
        description: "",
      });
      setEditingVmId(null);
      setVmModalOpen(true);
    },
    onStart: (jobId) => jobAction(jobId, "start"),
    onStop: (jobId) => jobAction(jobId, "stop"),
    onOpenLogs: (vmId) => setLogVmId(vmId),
    onDelete: handleDeleteVm,
    onEdit: handleEditVm,
    onRefreshVm: handleRefreshVmSingle,
    onRefreshList: refreshVms,
  };

  async function upsertAccount(form: AccountForm) {
    const id = form.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}`);
    const account: Account = {
      ...form,
      type: "yandex" as const,
      id,
      maxAddresses: form.maxAddresses ? Number(form.maxAddresses) : 2,
    };
    await withBusy(async () => {
      const validateRes = await fetch("/api/account/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account),
      });
      const validateData = await validateRes.json();
      if (!validateRes.ok) {
        notifications.show({
          title: t("error", lang),
          message: validateData.error ?? t("accountValidateFail", lang),
          color: "red",
        });
        return;
      }
      account.saName = validateData.info?.saName;
      account.saDescription = validateData.info?.saDescription;
      account.saRoles = validateData.info?.saRoles;
      // merge fetched vms/ips
      const fetchedVms: VmEntry[] = validateData.vms ?? [];
      const fetchedIps = validateData.ips ?? [];
      const baseCfg: AppConfig = config ?? { ycAccounts: [], ips: [], vms: [], jobs: [] };
      const existingOtherVms = (baseCfg.vms ?? []).filter((v) => v.accountId !== account.id);
      const existingAccountVms = (baseCfg.vms ?? []).filter((v) => v.accountId === account.id);
      const accountVms = fetchedVms.length > 0 ? fetchedVms : existingAccountVms;
      const mergedVms: VmEntry[] = [...existingOtherVms, ...accountVms];
      const existingJobs = baseCfg.jobs ?? [];
      const vmJobs: JobConfig[] = mergedVms.map((vm) => ({
        id: `vm-monitor-${vm.id}`,
        kind: "vm-monitor",
        name: `VM Monitor ${vm.name ?? vm.id}`,
        enabled: true,
        autoStart: false,
        settings: {
          vmId: vm.id,
          vmIp: vm.details?.publicIp ?? vm.ip,
          accountId: account.id,
          pingTimeoutMs: vm.pingTimeoutMs ?? Number(process.env.NEXT_PUBLIC_YC_VM_PING_TIMEOUT_MS ?? DEFAULT_PING_TIMEOUT),
          pingIntervalMs: vm.pingIntervalMs ?? Number(process.env.NEXT_PUBLIC_YC_VM_PING_INTERVAL_MS ?? DEFAULT_PING_INTERVAL),
          monitorMethod: vm.monitorMethod ?? "api",
        },
      }));
      const mergedJobs = [...existingJobs.filter((j) => !j.id.startsWith("vm-monitor-")), ...vmJobs];
      const existingOtherIps = (baseCfg.ips ?? []).filter((ip) => ip.accountId !== account.id);
      const accountIps = fetchedIps.length > 0 ? fetchedIps : (baseCfg.ips ?? []).filter((ip) => ip.accountId === account.id);
      const nextCfg: AppConfig = {
        ...baseCfg,
        ycAccounts: [...(baseCfg.ycAccounts ?? []).filter((a) => a.id !== id), account],
        vms: mergedVms,
        ips: [...existingOtherIps, ...accountIps],
        jobs: mergedJobs,
      };
      const savedRes = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextCfg),
      });
      const savedData = await savedRes.json();
      if (savedRes.ok) {
        setConfig(normalizeConfig(savedData.config));
        notifications.show({
          title: t("accountValidateOk", lang),
          message: t("accountValidateOkDesc", lang),
          color: "green",
        });
      } else {
        notifications.show({ title: t("error", lang), message: savedData.error ?? t("saveFail", lang), color: "red" });
      }
    }).catch((err) => {
      notifications.show({ title: t("error", lang), message: (err as Error).message, color: "red" });
      return;
    });
    setAccountModalOpen(false);
  }

  function subscribeLogs() {
    const es = new EventSource("/api/logging/stream");
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as LogRecord[];
        if (payload.length > 0) {
          setLogs((prev) => [...payload, ...prev].slice(0, 300));
          if (logVmId) {
            setLogModalEntries((prev) => [...payload.filter((l) => l.jobId === `vm-monitor-${logVmId}`), ...prev].slice(0, logLimit));
          }
          if (debug) console.log("logs received", payload);
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }

  if (loading) {
    return (
      <main style={{ padding: 32 }}>
        <Title order={3}>{t("loading", lang)}</Title>
      </main>
    );
  }

  if (!authed) {
    return (
      <main style={{ padding: 32, maxWidth: 360, margin: "0 auto" }}>
        <Title order={2} mb="md">
          {t("login", lang)}
        </Title>
        <Stack>
          <TextInput label={t("username", lang)} value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
          <TextInput
            label={t("password", lang)}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button onClick={login}>{t("signIn", lang)}</Button>
        </Stack>
      </main>
    );
  }

  return (
    <AppShell
      header={{ height: 60 }}
      padding="md"
      navbar={{
        width: 260,
        breakpoint: "sm",
        collapsed: { mobile: !navOpened },
      }}
    >
      <AppShell.Header>
        <Group px="md" py="sm" justify="space-between">
          <Group gap="md">
            <Burger opened={navOpened} onClick={() => setNavOpened((v) => !v)} hiddenFrom="sm" size="sm" />
            <Title order={3}>{t("panelTitle", lang)}</Title>
            <Tooltip label={t("theme", lang)}>
              <ActionIcon
                variant="light"
                onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
                aria-label="theme-toggle"
              >
                {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("language", lang)}>
              <ActionIcon variant="light" onClick={() => setLang(lang === "ru" ? "en" : "ru")} aria-label="lang-toggle">
                <IconLanguageHiragana size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("refresh", lang)}>
              <ActionIcon variant="light" onClick={loadJobs} aria-label="refresh">
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <NavLink
          label={t("navSettings", lang)}
          leftSection={<IconSettings size={16} />}
          active={activeSection === "settings"}
          onClick={() => setActiveSection("settings")}
        />
        <NavLink
          label={t("navVms", lang)}
          leftSection={<IconTopologyStar size={16} />}
          active={activeSection === "vms"}
          onClick={() => setActiveSection("vms")}
        />
        <NavLink
          label={t("navIps", lang)}
          leftSection={<IconListCheck size={16} />}
          active={activeSection === "ips"}
          onClick={() => setActiveSection("ips")}
        />
        <NavLink
          label={t("navLogs", lang)}
          leftSection={<IconListDetails size={16} />}
          active={activeSection === "logs"}
          onClick={() => setActiveSection("logs")}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Box pos="relative">
          <LoadingOverlay visible={busy} overlayProps={{ blur: 2 }} />
          <Stack>
          {activeSection === "settings" && (
            <AccountsSection
              accounts={config?.ycAccounts ?? []}
              lang={lang}
              onAdd={handleAddAccount}
              onEdit={handleEditAccount}
              onDelete={handleDeleteAccount}
            />
          )}
          {activeSection === "ips" && (
            <IpSection
              config={config}
              cidrs={cidrs}
          lang={lang}
          newIp={newIp}
          ipModalOpen={ipModalOpen}
          setIpModalOpen={setIpModalOpen}
          setNewIp={setNewIp}
          onOpenAdd={openIpModal}
          onRefresh={handleRefreshIps}
          onAllocate={handleAllocateIp}
          onDelete={handleDeleteIp}
          allocRunning={allocRunning}
          allocLogs={allocLogs}
          onAbortAlloc={() => {
            allocAbortRef.current = true;
          }}
          allocResult={allocResult}
          onCloseResult={() => setAllocResult(null)}
        />
          )}

          {activeSection === "vms" && (
            <VmSection
              vms={config?.vms ?? []}
              accounts={config?.ycAccounts ?? []}
              jobs={config?.jobs ?? []}
              statuses={statuses}
              lang={lang}
              formatRelative={formatRelative}
              actions={vmActions}
            />
          )}
          {activeSection === "logs" && (
            <Card withBorder>
              <Group justify="space-between">
                <Title order={4}>{t("logsTitle", lang)}</Title>
              </Group>
              <Divider my="sm" />
              <ScrollArea h={360}>
                <Stack gap="xs">
                  {logs.map((log) => (
                    <Group key={log.id} gap="sm" align="flex-start">
                      <Badge color={log.level === "error" ? "red" : "blue"}>{log.level}</Badge>
                      <Text size="sm">
                        [{new Date(log.createdAt).toLocaleTimeString()}] ({log.jobId}) {log.message}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </ScrollArea>
            </Card>
          )}
        </Stack>
        </Box>
      </AppShell.Main>
      <AccountModal
        opened={accountModalOpen}
        onClose={() => {
          setEditingAccount(undefined);
          setAccountModalOpen(false);
        }}
        lang={lang}
        initial={editingAccount}
        onSubmit={upsertAccount}
      />
      <Modal
        opened={vmModalOpen}
        onClose={() => {
          setEditingVmId(null);
          setVmModalOpen(false);
        }}
        title={editingVmId ? t("vmSave", lang) : t("addVm", lang)}
        size="lg"
      >
        <Stack>
          <Group grow>
            <Select
              label={t("vmAccount", lang)}
              description={t("vmAccountDesc", lang)}
              placeholder={t("vmAccountDesc", lang)}
              data={(config?.ycAccounts ?? []).map((acc) => ({
                value: acc.id,
                label: `${acc.name} (YC)`,
              }))}
              value={newVm.accountId}
              onChange={(value) => setNewVm({ ...newVm, accountId: value ?? "" })}
            />
            <TextInput
              label={t("vmId", lang)}
              description={t("vmIdDesc", lang)}
              value={newVm.id}
              onChange={(e) => setNewVm({ ...newVm, id: e.currentTarget.value })}
            />
          </Group>
          <TextInput
            label={t("vmDescription", lang)}
            description={t("vmDescriptionDesc", lang)}
            value={newVm.description ?? ""}
            onChange={(e) => setNewVm({ ...newVm, description: e.currentTarget.value })}
          />
          <Group grow>
            <TextInput
              label={t("vmPingTimeout", lang)}
              description={t("vmPingTimeoutDesc", lang)}
              type="number"
              value={newVm.pingTimeoutMs}
              onChange={(e) => setNewVm({ ...newVm, pingTimeoutMs: e.currentTarget.value })}
            />
            <TextInput
              label={t("vmPingInterval", lang)}
              description={t("vmPingIntervalDesc", lang)}
              type="number"
              value={newVm.pingIntervalMs}
              onChange={(e) => setNewVm({ ...newVm, pingIntervalMs: e.currentTarget.value })}
            />
            <Select
              label={t("vmMonitorMethod", lang)}
              description={t("vmMonitorMethodDesc", lang)}
              data={[
                { value: "ping", label: t("monitorPing", lang) },
                { value: "api", label: t("monitorApi", lang) },
              ]}
              value={newVm.monitorMethod}
              onChange={(value) => setNewVm({ ...newVm, monitorMethod: (value as "ping" | "api") ?? "ping" })}
            />
          </Group>
          <Group justify="flex-end">
            <Button
              leftSection={editingVmId ? <IconDeviceFloppy size={14} /> : <IconPlus size={14} />}
              loading={addingVm}
              onClick={async () => {
                const account = resolveAccount(newVm.accountId);
                if (!account) {
                  notifications.show({ title: t("error", lang), message: t("vmAccountRequired", lang), color: "red" });
                  return;
                }
                if (!newVm.id) {
                  notifications.show({ title: t("error", lang), message: t("vmIdDesc", lang), color: "red" });
                  return;
                }
                const exists = (config?.vms ?? []).find((v) => v.id === newVm.id);
                if (exists && !editingVmId) {
                  notifications.show({ title: t("error", lang), message: t("vmExists", lang), color: "red" });
                  return;
                }
                try {
                  setAddingVm(true);
                  const res = await fetch("/api/vm/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: newVm.id, accountId: account.id, cloud: account.type }),
                  });
                  const data = await res.json();
                  if (!res.ok || !data.vm) {
                    notifications.show({
                      title: t("error", lang),
                      message: data.error ?? t("saveFail", lang),
                      color: "red",
                    });
                    return;
                  }
                  const vm = data.vm;
                  const vmIdToUse = editingVmId || vm.id;
                  const baseCfg: AppConfig = config ?? { ycAccounts: [], ips: [], vms: [], jobs: [] };
                  const nextCfg: AppConfig = {
                    ...baseCfg,
                    vms: [
                      ...(baseCfg.vms ?? []).filter((v) => v.id !== vmIdToUse),
                      {
                        ...vm,
                        id: vmIdToUse,
                        accountId: account.id,
                        cloud: account.type ?? vm.cloud ?? "yandex",
                        pingTimeoutMs: Number(newVm.pingTimeoutMs) || undefined,
                        pingIntervalMs: Number(newVm.pingIntervalMs) || undefined,
                        monitorMethod: newVm.monitorMethod as "ping" | "api",
                        description: newVm.description,
                      },
                    ],
                    jobs: (baseCfg.jobs ?? []).map((j) =>
                      j.id === `vm-monitor-${vmIdToUse}`
                        ? {
                            ...j,
                            settings: {
                              ...(j.settings ?? {}),
                              vmId: vmIdToUse,
                              vmIp: vm.details?.publicIp ?? vm.ip,
                              accountId: account.id,
                              pingTimeoutMs: Number(newVm.pingTimeoutMs) || undefined,
                              pingIntervalMs: Number(newVm.pingIntervalMs) || undefined,
                              monitorMethod: newVm.monitorMethod as "ping" | "api",
                            },
                          }
                        : j,
                    ),
                  };
                  await persistConfig(nextCfg);
                  setNewVm({
                    id: "",
                    accountId: account.id,
                    pingTimeoutMs: DEFAULT_PING_TIMEOUT,
                    pingIntervalMs: DEFAULT_PING_INTERVAL,
                    monitorMethod: "ping",
                    description: "",
                  });
                  setEditingVmId(null);
                  setVmModalOpen(false);
                  notifications.show({ title: t("saved", lang), message: t("vmValidated", lang), color: "green" });
                } finally {
                  setAddingVm(false);
                }
              }}
            >
              {editingVmId ? t("vmSave", lang) : t("addVm", lang)}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={!!logVmId} onClose={() => setLogVmId(null)} title={t("logsTitle", lang)} size="lg">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {t("vmLogsHint", lang)}
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                loading={logLoading}
                onClick={() => logVmId && loadVmLogs(logVmId, 40)}
              >
                {t("logsReload", lang)}
              </Button>
              <Button
                size="xs"
                variant="light"
                loading={logLoading}
                onClick={() => logVmId && loadVmLogs(logVmId, Math.max(logLimit, 1000))}
              >
                {t("logsLoadAll", lang)}
              </Button>
            </Group>
          </Group>
          <ScrollArea h={360}>
            <pre style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap" }}>
              {logModalEntries.length === 0
                ? t("logsEmpty", lang)
                : logModalEntries
                    .slice()
                    .reverse()
                    .map(
                      (log) =>
                        `[${new Date(log.createdAt).toLocaleTimeString()}][${log.level}] ${log.message}`,
                    )
                    .join("\n")}
            </pre>
          </ScrollArea>
        </Stack>
      </Modal>
    </AppShell>
  );
}

export default dynamic(() => Promise.resolve(Page), { ssr: false });
