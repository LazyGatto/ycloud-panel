import axios, { AxiosError, AxiosInstance } from "axios";

export function describeAxiosError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return (error as Error)?.message ?? String(error);
  }
  const err = error as AxiosError;
  const status = err.response?.status;
  const data = err.response?.data;
  const url = err.config?.url;
  return `status=${status ?? "unknown"} url=${url ?? "unknown"} message=${err.message} response=${JSON.stringify(
    data,
    null,
    2,
  )}`;
}

export function createClient(baseURL: string, iamToken: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${iamToken}`,
      "Content-Type": "application/json",
    },
  });
}

export async function waitForOperation(
  operationsClient: AxiosInstance,
  operationId: string,
  description: string,
  timeoutMs = 60_000,
  pollIntervalMs = 2000,
): Promise<unknown> {
  const started = Date.now();
  while (true) {
    const { data } = await operationsClient.get<{ done?: boolean; error?: { code?: number; message?: string }; response?: unknown; metadata?: Record<string, unknown> }>(
      `/${operationId}`,
    );
    if (data.done) {
      if (data.error) {
        throw new Error(
          `${description} failed: code=${data.error.code ?? "unknown"} message=${data.error.message ?? "unknown"}`,
        );
      }
      return data;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${description} timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
