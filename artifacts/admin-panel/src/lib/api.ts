const BASE = "/api/admin";

function getKey(): string {
  return localStorage.getItem("adminKey") ?? "";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": getKey(),
      ...(options?.headers ?? {}),
    },
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function get<T>(path: string) {
  return request<T>(path);
}

export function post<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function put<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export interface PlatformSettings {
  platformName: string;
  maintenanceMode: boolean;
  tradingEnabled: boolean;
}

export interface TradeSettings {
  maxOpenOrdersPerUser: number;
  disputePeriodHours: number;
  minTradeAmountUsd: number;
  maxTradeAmountUsd: number;
}

export interface KycSettings {
  kycRequiredForAds: boolean;
  kycRequiredForOrders: boolean;
  autoRejectAfterDays: number;
  allowMerchantWithoutKyc: boolean;
}

export interface VolumeTiers {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

export interface Stats {
  totalProfiles: number;
  pendingKyc: number;
  verifiedKyc: number;
  merchants: number;
  openDisputes: number;
  totalAds: number;
  totalOrders: number;
}

export interface Profile {
  id: string;
  mxcAddress: string;
  displayName: string;
  totalTrades: number;
  completedTrades: number;
  disputesLost: number;
  avgRating: string;
  kycStatus: "none" | "pending" | "verified" | "rejected";
  kycName: string | null;
  kycDocType: string | null;
  kycSubmittedAt: string | null;
  kycVerifiedAt: string | null;
  isMerchant: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  orderId: string;
  senderAddress: string;
  content: string;
  isSystem: boolean;
  createdAt: string;
}

export interface DisputeItem {
  dispute: {
    id: string;
    orderId: string;
    openedBy: string;
    reason: string;
    description: string;
    evidence: string | null;
    status: "open" | "resolved_buyer" | "resolved_seller";
    resolvedBy: string | null;
    resolution: string | null;
    resolvedAt: string | null;
    createdAt: string;
  };
  order: {
    id: string;
    buyerAddress: string;
    sellerAddress: string;
    token: string;
    cryptoAmount: string;
    fiatAmount: string;
    paymentMethod: string;
    status: string;
    createdAt: string;
  };
}

export interface Dispute {
  disputes: DisputeItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PagedProfiles {
  profiles: Profile[];
  total: number;
  page: number;
  limit: number;
}
