import { AxiosInstance } from "axios";
import { waitForOperation } from "../core/http";

export type ExternalIpv4Address = {
  address?: string;
  zoneId?: string;
};

export type Address = {
  id: string;
  folderId?: string;
  reserved?: boolean;
  externalIpv4Address?: ExternalIpv4Address;
  labels?: Record<string, string>;
};

type AddressListResponse = {
  addresses: Address[];
};

type Operation = {
  id: string;
  done?: boolean;
  response?: unknown;
  metadata?: Record<string, unknown>;
  error?: { code?: number; message?: string };
};

type CreateAddressResponse = {
  address?: Address;
  addressId?: string;
};

export async function listAddresses(client: AxiosInstance, folderId: string): Promise<Address[]> {
  const { data } = await client.get<AddressListResponse>("/addresses", { params: { folderId } });
  return data.addresses ?? [];
}

export async function getAddress(client: AxiosInstance, addressId: string): Promise<Address> {
  const { data } = await client.get<Address>(`/addresses/${addressId}`);
  return data;
}

export async function allocateAddress(
  vpcClient: AxiosInstance,
  operationsClient: AxiosInstance,
  folderId: string,
  zoneId: string,
  labelKey?: string,
  labelValue?: string,
): Promise<Address> {
  const payload: Record<string, unknown> = {
    folderId,
    externalIpv4AddressSpec: {
      zoneId,
    },
  };
  if (labelKey && labelValue) {
    payload.labels = { [labelKey]: labelValue };
  }
  const { data } = await vpcClient.post<Operation>("/addresses", payload);
  const opId = data.id;
  if (!opId) {
    throw new Error("Create address operation id is missing");
  }
  const opResult = (await waitForOperation(operationsClient, opId, "Create address")) as Operation;
  const response = opResult.response as CreateAddressResponse | undefined;
  const addressId =
    response?.addressId ?? response?.address?.id ?? (opResult.metadata as { addressId?: string })?.addressId;
  if (!addressId) {
    throw new Error("Create address operation finished but address id was not returned");
  }
  return getAddress(vpcClient, addressId);
}

export async function deleteAddress(
  vpcClient: AxiosInstance,
  operationsClient: AxiosInstance,
  addressId: string,
  description: string,
): Promise<void> {
  const { data } = await vpcClient.delete<Operation>(`/addresses/${addressId}`);
  const opId = data.id;
  if (!opId) {
    throw new Error(`Delete address operation id is missing for ${description}`);
  }
  await waitForOperation(operationsClient, opId, `Delete address ${description}`);
}
