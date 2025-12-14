import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@lib/authGuard";
import { randomUUID } from "crypto";
import { loadConfig, saveConfig } from "@server/configStore";
import { AppConfig, CloudCredentials } from "@server/types";
import { fetchYcInstance } from "@server/vmService";

function sanitizeConfig(cfg: AppConfig): AppConfig {
  const cleanAccounts = (arr?: CloudCredentials[]) =>
    (arr ?? []).map((acc) => {
      const { keyContent, ...rest } = acc;
      return rest;
    });
  return {
    ...cfg,
    ycAccounts: cleanAccounts(cfg.ycAccounts),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const cfg = await loadConfig();
  return NextResponse.json(sanitizeConfig(cfg));
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.authed) return auth.response as NextResponse;
  const body = (await req.json()) as AppConfig;
  const current = await loadConfig();

  // assign ids to new accounts if missing
  const ycAccounts: CloudCredentials[] = (body.ycAccounts ?? []).map((acc) => ({
    ...acc,
    id: acc.id || randomUUID(),
    type: "yandex",
  }));

  // merge keyContent from current config if not provided
  const mergeKey = (incoming: CloudCredentials, existingList?: CloudCredentials[]) => {
    if (incoming.keyContent) return incoming;
    const found = existingList?.find((a) => a.id === incoming.id);
    if (found?.keyContent) return { ...incoming, keyContent: found.keyContent };
    return incoming;
  };

  body.ycAccounts = ycAccounts.map((acc) => mergeKey(acc, current.ycAccounts));

  const saved = await saveConfig(body);
  return NextResponse.json({ ok: true, config: sanitizeConfig(saved), rejectedVmIds: [] });
}
