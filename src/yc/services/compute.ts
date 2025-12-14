import { AxiosInstance } from "axios";
import { waitForOperation } from "../core/http";

export type Instance = {
  id: string;
  name?: string;
  status?: string;
  labels?: Record<string, string>;
  zoneId?: string;
  networkInterfaces?: { primaryV4Address?: { address?: string; oneToOneNat?: { address?: string } } }[];
  resources?: { cores?: number; coreFraction?: number; memory?: number };
  schedulingPolicy?: { preemptible?: boolean };
  platformId?: string;
};

type Operation = {
  id: string;
  done?: boolean;
  response?: unknown;
  metadata?: Record<string, unknown>;
  error?: { code?: number; message?: string };
};

export async function getInstance(client: AxiosInstance, instanceId: string): Promise<Instance> {
  const { data } = await client.get<Instance>(`/instances/${instanceId}`);
  return data;
}

export async function listInstances(client: AxiosInstance, folderId: string): Promise<Instance[]> {
  const { data } = await client.get<{ instances?: Instance[] }>("/instances", {
    params: { folderId },
  });
  return data.instances ?? [];
}

export async function startInstance(
  computeClient: AxiosInstance,
  operationsClient: AxiosInstance,
  instanceId: string,
): Promise<void> {
  const { data } = await computeClient.post<Operation>(`/instances/${instanceId}:start`);
  const opId = data.id;
  if (!opId) {
    throw new Error(`Start instance operation id is missing for ${instanceId}`);
  }
  await waitForOperation(operationsClient, opId, `Start instance ${instanceId}`, 180_000);
}
