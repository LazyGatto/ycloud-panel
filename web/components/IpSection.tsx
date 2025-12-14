"use client";

import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { t } from "../lib/i18n";
import type { AppConfig } from "../lib/types";

function ipToLong(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return Number.MAX_SAFE_INTEGER;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function sortCidrs(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const [ab, am] = a.split("/");
    const [bb, bm] = b.split("/");
    const aLong = ipToLong(ab ?? "");
    const bLong = ipToLong(bb ?? "");
    if (aLong === bLong) return Number(am) - Number(bm);
    return aLong - bLong;
  });
}

export type NewIpState = {
  accountId: string;
  useTarget: boolean;
  useMask: boolean;
  targetCidrs: string[];
  mask: string;
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
};

export type IpAllocLog = {
  attempt: number;
  ip?: string;
  matched?: boolean;
  message: string; // уже содержит человекочитаемый текст
};

type Props = {
  config: AppConfig | null;
  cidrs: string[];
  lang: "ru" | "en";
  newIp: NewIpState;
  ipModalOpen: boolean;
  setIpModalOpen: (v: boolean) => void;
  setNewIp: (fn: (prev: NewIpState) => NewIpState) => void;
  onRefresh: () => Promise<void>;
  onOpenAdd: () => void;
  onAllocate: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  allocRunning: boolean;
  allocLogs: IpAllocLog[];
  onAbortAlloc: () => void;
  allocResult: { success: boolean; message: string; logs: IpAllocLog[] } | null;
  onCloseResult: () => void;
};

export function IpSection({
  config,
  cidrs,
  lang,
  newIp,
  setNewIp,
  ipModalOpen,
  setIpModalOpen,
  onRefresh,
  onOpenAdd,
  onAllocate,
  onDelete,
  allocRunning,
  allocLogs,
  onAbortAlloc,
  allocResult,
  onCloseResult,
}: Props) {
  return (
    <>
      <Card withBorder>
        <Group justify="space-between" align="center">
          <div>
            <Title order={4}>{t("ipTitle", lang)}</Title>
            <Text size="sm" c="dimmed">
              {t("ipDesc", lang)}
            </Text>
          </div>
          <Group>
            <Button leftSection={<IconRefresh size={14} />} onClick={onRefresh}>
              {t("refresh", lang)}
            </Button>
            <Button leftSection={<IconPlus size={14} />} onClick={onOpenAdd}>
              {t("addIp", lang)}
            </Button>
          </Group>
        </Group>
        <Divider my="sm" />
        <Stack gap="sm">
          {(config?.ips ?? []).map((ip) => (
            <Card key={ip.id} withBorder>
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text fw={600}>{ip.address}</Text>
                  <Group gap="xs" align="center">
                    {(() => {
                      const acc = (config?.ycAccounts ?? []).find((a) => a.id === ip.accountId);
                      if (acc) return <Badge variant="light" color="blue">{acc.name}</Badge>;
                      if (ip.accountId) return <Badge variant="light">Acc: {ip.accountId}</Badge>;
                      return null;
                    })()}
                    <Badge>{ip.status ?? "unknown"}</Badge>
                    {ip.zoneId && <Badge variant="light">{ip.zoneId}</Badge>}
                    {ip.deletionProtection && <Badge color="red">{t("ipProtected", lang)}</Badge>}
                    {ip.assignedTo?.vmName && <Badge color="blue">VM: {ip.assignedTo.vmName}</Badge>}
                  </Group>
                </Stack>
                {!ip.deletionProtection && (
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={() => {
                      const acc = (config?.ycAccounts ?? []).find((a) => a.id === ip.accountId);
                      const accLabel = acc ? ` (${acc.name})` : "";
                      if (confirm(`${t("ipDeleteConfirm", lang)} ${ip.address}${accLabel}`)) {
                        onDelete(ip.id);
                      }
                    }}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Card>
          ))}
          {(config?.ips ?? []).length === 0 && <Text c="dimmed">{t("ipEmpty", lang)}</Text>}
        </Stack>
      </Card>

      <Modal opened={ipModalOpen} onClose={() => setIpModalOpen(false)} title={t("addIp", lang)} size="lg">
        <Stack>
          <Select
            label={t("ipAccount", lang)}
            data={(config?.ycAccounts ?? [])
              .filter((a) => {
                const limit = a.maxAddresses ?? 2;
                const count = (config?.ips ?? []).filter((ip) => ip.accountId === a.id).length;
                return count < limit;
              })
              .map((a) => ({ value: a.id, label: a.name }))}
            value={newIp.accountId}
            onChange={(v) => setNewIp((p) => ({ ...p, accountId: v ?? "" }))}
            placeholder={
              (config?.ycAccounts ?? [])
                .filter((a) => {
                  const limit = a.maxAddresses ?? 2;
                  const count = (config?.ips ?? []).filter((ip) => ip.accountId === a.id).length;
                  return count < limit;
                })[0]?.name
            }
            disabled={allocRunning}
          />
          <Checkbox
            label={t("ipUseTarget", lang)}
            checked={newIp.useTarget}
            onChange={(e) => {
              const checked = Boolean(e?.currentTarget?.checked);
              setNewIp((p) => ({ ...p, useTarget: checked }));
            }}
            disabled={allocRunning}
          />
          {newIp.useTarget && (
            <Stack gap="xs">
              <Checkbox
                label={t("ipUseMask", lang)}
                checked={newIp.useMask}
                onChange={(e) => {
                  const checked = Boolean(e?.currentTarget?.checked);
                  setNewIp((p) => ({ ...p, useMask: checked }));
                }}
                disabled={allocRunning}
              />
              {!newIp.useMask && (
                <Checkbox.Group
                  label={t("ipAvailableCidrs", lang)}
                  value={newIp.targetCidrs}
                  onChange={(vals) => setNewIp((p) => ({ ...p, targetCidrs: vals }))}
                  disabled={allocRunning}
                >
                  <ScrollArea h={200}>
                    <Stack gap={4}>
                      {sortCidrs(cidrs).map((c) => (
                        <Checkbox key={c} value={c} label={c} />
                      ))}
                    </Stack>
                  </ScrollArea>
                </Checkbox.Group>
              )}
              <TextInput
                label={newIp.useMask ? t("ipMask", lang) : t("ipMaskOptional", lang)}
                placeholder="95.50.197.*"
                value={newIp.mask}
                onChange={(e) => setNewIp((p) => ({ ...p, mask: e.currentTarget.value }))}
                disabled={allocRunning}
              />
              <Group grow>
                <NumberInput
                  label={t("ipAttempts", lang)}
                  value={newIp.attempts}
                  onChange={(v) => setNewIp((p) => ({ ...p, attempts: Number(v) || 0 }))}
                  disabled={allocRunning}
                />
                <NumberInput
                  label={t("ipMinDelay", lang)}
                  value={newIp.minDelayMs}
                  onChange={(v) => setNewIp((p) => ({ ...p, minDelayMs: Number(v) || 0 }))}
                  disabled={allocRunning}
                />
                <NumberInput
                  label={t("ipMaxDelay", lang)}
                  value={newIp.maxDelayMs}
                  onChange={(v) => setNewIp((p) => ({ ...p, maxDelayMs: Number(v) || 0 }))}
                  disabled={allocRunning}
                />
              </Group>
            </Stack>
          )}
          <Stack gap="sm">
            {allocRunning && (
              <Card withBorder>
                <Text fw={600}>{t("ipAllocProgress", lang)}</Text>
                  <ScrollArea h={160} mt="xs">
                    <Stack gap={4}>
                      {allocLogs.map((log) => (
                        <Text key={`${log.attempt}-${log.ip ?? log.message}`} size="sm">
                          {log.message}
                      </Text>
                    ))}
                  </Stack>
                </ScrollArea>
                <Group justify="flex-end" mt="sm">
                  <Button variant="light" color="red" onClick={onAbortAlloc}>
                    {t("cancel", lang)}
                  </Button>
                </Group>
              </Card>
            )}
            <Group justify="flex-end">
              <Button onClick={onAllocate} loading={allocRunning}>
                {allocRunning ? t("ipAllocating", lang) : t("ipAllocate", lang)}
              </Button>
            </Group>
          </Stack>
        </Stack>
      </Modal>

      <Modal opened={allocResult !== null} onClose={onCloseResult} title={t("ipAllocResult", lang)}>
        <Stack>
          <Text fw={600} c={allocResult?.success ? "green" : "red"}>
            {allocResult?.message}
          </Text>
          <ScrollArea h={200}>
            <Stack gap={4}>
              {(allocResult?.logs ?? allocLogs).map((log) => (
                <Text key={`${log.attempt}-${log.ip ?? log.message}`} size="sm">
                  {log.message}
                </Text>
              ))}
            </Stack>
          </ScrollArea>
          <Group justify="flex-end">
            <Button onClick={onCloseResult}>{t("ok", lang)}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
