import fs from "fs";
import path from "path";
import axios from "axios";
import { describeAxiosError } from "../src/yc/core/http";

const CACHE_PATH = path.resolve(process.cwd(), "data", "cidr-cache.json");
const SOURCE_URL = "https://yandex.cloud/ru/docs/overview/concepts/public-ips";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadCachedCidrs(): Promise<string[]> {
  try {
    const raw = await fs.promises.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { cidrs: string[]; ts: number };
    if (Date.now() - (parsed.ts ?? 0) < CACHE_TTL_MS && Array.isArray(parsed.cidrs)) {
      return parsed.cidrs;
    }
  } catch {
    // ignore
  }
  return [];
}

async function saveCidrs(cidrs: string[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.promises.writeFile(CACHE_PATH, JSON.stringify({ cidrs, ts: Date.now() }, null, 2), "utf8");
}

export async function fetchCidrs(): Promise<string[]> {
  try {
    const { data } = await axios.get(SOURCE_URL, { timeout: 15000 });
    const matches = Array.from(
      new Set(Array.from(String(data).matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g)).map((m) => m[0])),
    );
    if (matches.length > 0) {
      await saveCidrs(matches);
      return matches;
    }
  } catch (err) {
    // ignore fetch error, fallback to cache
    console.error("Failed to fetch CIDR list:", describeAxiosError(err));
  }
  const cached = await loadCachedCidrs();
  if (cached.length > 0) return cached;
  // fallback to known YC public IP ranges (from docs snapshot)
  return [
    "84.201.128.0/18",
    "84.252.128.0/18",
    "89.169.128.0/18",
    "89.169.192.0/19",
    "89.169.224.0/20",
    "89.169.240.0/21",
    "141.8.192.0/19",
    "178.154.192.0/18",
    "185.15.96.0/22",
    "185.15.100.0/24",
    "185.15.101.0/25",
    "195.208.0.0/21",
    "213.180.192.0/18",
  ];
}
