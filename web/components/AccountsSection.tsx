"use client";

import { ActionIcon, Badge, Button, Card, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconPencil, IconTrash, IconPlus } from "@tabler/icons-react";
import { t } from "../lib/i18n";
import type { Account } from "../lib/types";

type Props = {
  accounts: Account[];
  lang: "ru" | "en";
  onAdd: () => void;
  onEdit: (acc: Account) => void;
  onDelete: (acc: Account) => void;
};

export function AccountsSection({ accounts, lang, onAdd, onEdit, onDelete }: Props) {
  return (
    <Card withBorder>
      <Group justify="space-between" align="center">
        <div>
          <Title order={4}>{t("accountsTitle", lang)}</Title>
          <Text size="sm" c="dimmed">
            {t("accountsDesc", lang)}
          </Text>
        </div>
        <Button onClick={onAdd} leftSection={<IconPlus size={14} />}>
          {t("addAccount", lang)}
        </Button>
      </Group>
      <Divider my="sm" />
      <Stack gap="sm">
        {accounts.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("noAccounts", lang)}
          </Text>
        )}
        {accounts.map((acc) => (
          <Group key={acc.id} justify="space-between" align="center">
            <Stack gap={4} style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={700}>{acc.name}</Text>
                <Badge color="blue">YC</Badge>
              </Group>
              <Group gap="xs" wrap="wrap">
                {acc.folderId && (
                  <Badge variant="light" size="sm" color="gray">
                    {t("accountFolder", lang)}: {acc.folderId}
                  </Badge>
                )}
                {acc.zoneId && (
                  <Badge variant="light" size="sm" color="gray">
                    {t("accountZone", lang)}: {acc.zoneId}
                  </Badge>
                )}
                {acc.maxAddresses && (
                  <Badge variant="light" size="sm" color="teal">
                    {t("accountMaxAddresses", lang)}: {acc.maxAddresses}
                  </Badge>
                )}
                {acc.saName && (
                  <Badge variant="outline" size="sm" color="gray">
                    SA: {acc.saName}
                  </Badge>
                )}
                {acc.saRoles && acc.saRoles.length > 0 && (
                  <Badge variant="light" size="sm" color="blue">
                    {t("accountRoles", lang)}: {acc.saRoles.join(", ")}
                  </Badge>
                )}
              </Group>
              {acc.saDescription && (
                <Text size="xs" c="dimmed">
                  {acc.saDescription}
                </Text>
              )}
            </Stack>
            <Group gap="xs">
              <ActionIcon variant="subtle" color="blue" onClick={() => onEdit(acc)}>
                <IconPencil size={16} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={() => onDelete(acc)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
