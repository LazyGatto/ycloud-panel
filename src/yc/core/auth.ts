import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import { describeAxiosError } from "./http";

export type ServiceAccountKey = {
  id: string;
  service_account_id: string;
  private_key: string;
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sanitizePrivateKey(privateKey: string): string {
  return privateKey.replace(/^PLEASE[^\n]*\n/, "").trim();
}

function loadServiceAccountKey(keyPath: string): ServiceAccountKey {
  const content = fs.readFileSync(keyPath, "utf8");
  const parsed = JSON.parse(content) as ServiceAccountKey;
  if (!parsed.id || !parsed.service_account_id || !parsed.private_key) {
    throw new Error(`Invalid service account key file: missing fields in ${keyPath}`);
  }
  return parsed;
}

function createJwt(key: ServiceAccountKey, iamAudience: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "PS256",
    typ: "JWT",
    kid: key.id,
  };
  const payload = {
    aud: iamAudience,
    iss: key.service_account_id,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const cleanedKey = sanitizePrivateKey(key.private_key);
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  const signature = sign.sign({
    key: cleanedKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${data}.${base64Url(signature)}`;
}

async function exchangeJwtForIamToken(jwt: string, iamUrl: string): Promise<{ iamToken: string; expiresAt: string }> {
  try {
    const { data } = await axios.post(
      iamUrl,
      { jwt },
      { timeout: 15000 },
    );
    return data as { iamToken: string; expiresAt: string };
  } catch (err) {
    const reason = describeAxiosError(err);
    throw new Error(`Failed to exchange JWT for IAM token: ${reason}`);
  }
}

let cachedIamToken: string | undefined;
let cachedIamTokenExpiresAt: number | undefined;
let cachedKeyFile: string | undefined;

export async function getIamToken(options: {
  keyFile?: string;
  iamToken?: string;
  iamUrl?: string;
  iamAudience?: string;
}): Promise<string> {
  const keyFilePath = options.keyFile || path.resolve(process.cwd(), "authorized_key.json");
  if (
    cachedIamToken &&
    cachedIamTokenExpiresAt &&
    Date.now() < cachedIamTokenExpiresAt - 5 * 60 * 1000 &&
    cachedKeyFile === keyFilePath
  ) {
    return cachedIamToken;
  }

  if (options.iamToken) {
    cachedIamToken = options.iamToken;
    cachedIamTokenExpiresAt = Date.now() + 11 * 60 * 60 * 1000;
    return cachedIamToken;
  }

  const iamUrl = options.iamUrl ?? "https://iam.api.cloud.yandex.net/iam/v1/tokens";
  const iamAudience = options.iamAudience ?? iamUrl;
  const keyPath = keyFilePath;
  const key = loadServiceAccountKey(keyPath);
  const jwt = createJwt(key, iamAudience);
  const tokenResponse = await exchangeJwtForIamToken(jwt, iamUrl);
  cachedIamToken = tokenResponse.iamToken;
  cachedIamTokenExpiresAt = new Date(tokenResponse.expiresAt).getTime();
  cachedKeyFile = keyPath;
  return cachedIamToken;
}

export { loadServiceAccountKey, createJwt };
