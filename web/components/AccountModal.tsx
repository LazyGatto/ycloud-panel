"use client";

import { useEffect, useState } from "react";
import { Button, Group, Modal, Select, Stack, Text, TextInput, Textarea, FileInput } from "@mantine/core";
import { t } from "../lib/i18n";
import type { Account } from "../lib/types";

export type AccountForm = {
  id?: string;
  name: string;
  type: "yandex" | "vk";
  folderId?: string;
  zoneId?: string;
  maxAddresses?: string;
  keyContent?: string;
  neutronUrl?: string;
  saName?: string;
  saDescription?: string;
  saRoles?: string[];
};

export function AccountModal({
  opened,
  onClose,
  lang,
  initial,
  onSubmit,
}: {
  opened: boolean;
  lang: "ru" | "en";
  initial?: AccountForm;
  onClose: () => void;
  onSubmit: (form: AccountForm) => void;
}) {
  const [form, setForm] = useState<AccountForm>(initial ?? { name: "", type: "yandex", maxAddresses: "2" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(initial ?? { name: "", type: "yandex", maxAddresses: "2" });
    setErrors({});
  }, [initial, opened]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name) next.name = t("requiredField", lang);
    if (form.type === "yandex") {
      if (!form.folderId) next.folderId = t("requiredField", lang);
      if (!form.zoneId) next.zoneId = t("requiredField", lang);
      if (!form.keyContent && !form.id) next.keyContent = t("requiredField", lang);
    } else if (form.type === "vk") {
      if (!form.neutronUrl) next.neutronUrl = t("requiredField", lang);
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit(form);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={initial ? t("editAccount", lang) : t("addAccount", lang)} size="lg">
      <Stack>
        <TextInput
          label={t("accountName", lang)}
          description={t("accountNameDesc", lang)}
          value={form.name}
          error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
        />
        <Group grow>
          <TextInput
            label={t("accountFolder", lang)}
            description={t("accountFolderDesc", lang)}
            value={form.folderId ?? ""}
            error={errors.folderId}
            onChange={(e) => setForm({ ...form, folderId: e.currentTarget.value })}
          />
          <TextInput
            label={t("accountZone", lang)}
            description={t("accountZoneDesc", lang)}
            value={form.zoneId ?? ""}
            error={errors.zoneId}
            onChange={(e) => setForm({ ...form, zoneId: e.currentTarget.value })}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t("accountMaxAddresses", lang)}
            type="number"
            description={t("accountMaxAddressesDesc", lang)}
            value={form.maxAddresses ?? ""}
            onChange={(e) => setForm({ ...form, maxAddresses: e.currentTarget.value })}
          />
        </Group>
        <Stack gap={4}>
          <Text fw={600}>{t("accountKey", lang)}</Text>
          <Text size="xs" c="dimmed">
            {t("accountKeyHint", lang)}
          </Text>
          <Group align="center" gap="md" wrap="nowrap">
            <Textarea
              flex={1}
              description={t("accountKeyContentDesc", lang)}
              minRows={4}
              value={form.keyContent ?? ""}
              placeholder={initial?.id ? t("accountKeyPlaceholder", lang) : undefined}
              error={errors.keyContent}
              onChange={(e) => setForm({ ...form, keyContent: e.currentTarget.value })}
            />
            <Group gap="xs" align="center" style={{ borderLeft: "1px solid var(--mantine-color-gray-4)", paddingLeft: 12 }}>
              <Button
                variant="light"
                onClick={() => {
                  document.getElementById("account-key-file-input")?.click();
                }}
              >
                {t("accountKeyUpload", lang)}
              </Button>
              <FileInput
                id="account-key-file-input"
                accept=".json"
                style={{ display: "none" }}
                onChange={(file) => {
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    setForm({ ...form, keyContent: reader.result?.toString() ?? "" });
                  };
                  reader.readAsText(file);
                }}
              />
            </Group>
          </Group>
        </Stack>
        <Group justify="flex-end">
          <Button onClick={handleSubmit}>{t("save", lang)}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
