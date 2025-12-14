"use client";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconListDetails, IconPlayerPlay, IconPlayerStop, IconPlus, IconRefresh, IconTrash, IconPencil } from "@tabler/icons-react";
import { t } from "../lib/i18n";
import type { Account, VmEntry, JobRuntimeInfo, JobConfig } from "../lib/types";

export type VmActions = {
  onAdd: () => void;
  onStart: (jobId: string) => void;
  onStop: (jobId: string) => void;
  onOpenLogs: (vmId: string) => void;
  onDelete: (vmId: string) => void;
  onEdit: (vm: VmEntry) => void;
  onRefreshVm: (vm: VmEntry, account: Account) => Promise<void>;
  onRefreshList: () => void;
};

type Props = {
  vms: VmEntry[];
  accounts: Account[];
  jobs: JobConfig[];
  statuses: JobRuntimeInfo[];
  lang: "ru" | "en";
  formatRelative: (ts?: number) => string;
  actions: VmActions;
};

export function VmSection({ vms, accounts, jobs, statuses, lang, formatRelative, actions }: Props) {
  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" align="center">
          <div>
            <Title order={4}>{t("vmsTitle", lang)}</Title>
            <Text size="sm" c="dimmed">
              {t("vmsDesc", lang)}
            </Text>
          </div>
          <Group gap="sm">
            <Button leftSection={<IconRefresh size={14} />} variant="light" onClick={actions.onRefreshList}>
              {t("refresh", lang)}
            </Button>
            <Button leftSection={<IconPlus size={14} />} onClick={actions.onAdd}>
              {t("addVm", lang)}
            </Button>
          </Group>
        </Group>
        <Stack gap="sm" mt="sm">
          {vms.map((vm) => {
            const account = accounts.find((a) => a.id === vm.accountId);
            const monitorJob = jobs.find((j) => j.id === `vm-monitor-${vm.id}`);
            const monitorStatus = statuses.find((s) => s.id === monitorJob?.id);
            const updatedAt = monitorStatus?.updatedAt ?? vm.statusFetchedAt;
            return (
              <Card key={vm.id} withBorder shadow="xs">
                <Group justify="space-between" align="flex-start">
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Group gap="xs">
                      <Text fw={700}>{vm.name ?? vm.id}</Text>
                      <Badge color="blue">YC</Badge>
                      {account && <Badge variant="light">{account.name}</Badge>}
                      <Badge color={monitorStatus?.status === "running" ? "green" : "gray"}>
                        {monitorStatus?.status ?? "idle"}
                      </Badge>
                    </Group>
                    <Group gap="xs" wrap="wrap">
                      <Badge color={vm.status === "RUNNING" ? "green" : "gray"} size="sm">
                        {vm.status ?? t("unknown", lang)}
                      </Badge>
                      {updatedAt && (
                        <Badge variant="light" size="sm" color="gray">
                          {t("vmUpdatedAgo", lang)} {formatRelative(updatedAt)}
                        </Badge>
                      )}
                      <Badge variant="light" size="sm" color="gray">
                        ID: {vm.id}
                      </Badge>
                    </Group>
                    <Group gap="xs" wrap="wrap">
                      <Badge variant="light" color="blue" size="sm">
                        {t("vmPublicIp", lang)}: {vm.details?.publicIp ?? vm.ip ?? "—"}
                      </Badge>
                      <Badge variant="light" color="gray" size="sm">
                        {t("vmInternalIp", lang)}: {vm.details?.internalIp ?? "—"}
                      </Badge>
                    </Group>
                    <Group gap="xs" wrap="wrap">
                      <Badge variant="outline" color="gray" size="sm">
                        {t("vmCores", lang)}: {vm.details?.cores ?? "?"}
                      </Badge>
                      <Badge variant="outline" color="gray" size="sm">
                        {t("vmCoreFraction", lang)}: {vm.details?.coreFraction ?? "?"}%
                      </Badge>
                      <Badge variant="outline" color="gray" size="sm">
                        {t("vmMemory", lang)}:{" "}
                        {vm.details?.memoryBytes ? Math.round(vm.details.memoryBytes / (1024 * 1024 * 1024)) + " GB" : "?"}
                      </Badge>
                      <Badge variant="outline" color="gray" size="sm">
                        {t("vmPreemptible", lang)}: {vm.details?.preemptible ? "Yes" : "No"}
                      </Badge>
                      <Badge variant="outline" color="gray" size="sm">
                        {t("vmPlatform", lang)}: {vm.details?.platformId ?? "?"}
                      </Badge>
                    </Group>
                    <Group gap="xs" wrap="wrap">
                      <Badge variant="light" color="teal" size="sm">
                        {t("vmPingTimeout", lang)}: {vm.pingTimeoutMs ?? "default"}
                      </Badge>
                      <Badge variant="light" color="teal" size="sm">
                        {t("vmPingInterval", lang)}: {vm.pingIntervalMs ?? "default"}
                      </Badge>
                      <Badge variant="outline" color="blue" size="sm">
                        {t("vmMonitorMethod", lang)}: {vm.monitorMethod === "api" ? t("monitorApi", lang) : t("monitorPing", lang)}
                      </Badge>
                      {vm.description && (
                        <Badge variant="light" color="gray" size="sm">
                          {vm.description}
                        </Badge>
                      )}
                    </Group>
                  </Stack>
                  <Stack gap="xs" align="flex-end">
                    <Group gap="xs">
                      {monitorStatus?.status === "running" ? (
                        <ActionIcon
                          color="red"
                          variant="filled"
                          onClick={() => monitorJob && actions.onStop(monitorJob.id)}
                          disabled={!monitorJob}
                          title={t("stop", lang)}
                        >
                          <IconPlayerStop size={16} />
                        </ActionIcon>
                      ) : (
                        <ActionIcon
                          color="green"
                          variant="filled"
                          onClick={() => monitorJob && actions.onStart(monitorJob.id)}
                          disabled={!monitorJob}
                          title={t("start", lang)}
                        >
                          <IconPlayerPlay size={16} />
                        </ActionIcon>
                      )}
                      <ActionIcon
                        color="cyan"
                        variant="subtle"
                        onClick={() => actions.onOpenLogs(vm.id)}
                        disabled={!monitorJob}
                        title={t("logsTitle", lang)}
                      >
                        <IconListDetails size={16} />
                      </ActionIcon>
                    </Group>
                    <Group gap="xs">
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        onClick={() => {
                          if (!confirm(t("vmDeleteConfirm", lang))) return;
                          actions.onDelete(vm.id);
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                      <ActionIcon color="blue" variant="subtle" onClick={() => actions.onEdit(vm)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        color="teal"
                        variant="subtle"
                        onClick={() => {
                          if (account) {
                            actions.onRefreshVm(vm, account);
                          }
                        }}
                      >
                        <IconRefresh size={16} />
                      </ActionIcon>
                    </Group>
                  </Stack>
                </Group>
              </Card>
            );
          })}
          {vms.length === 0 && (
            <Text c="dimmed" size="sm">
              {t("vmsEmpty", lang)}
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
