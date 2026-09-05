import { Platform } from "react-native";
import { getPublicApiBase } from "./api";
import { ethAddressToMxc } from "./crypto";

// Re-export types used across the P2P UI
export interface P2pProfile {
  id: string;
  mxcAddress: string;
  displayName: string;
  phone?: string | null;
  totalTrades: number;
  completedTrades: number;
  disputesLost: number;
  avgRating: string;
  kycStatus: "none" | "pending" | "verified" | "rejected";
  isMerchant: boolean;
  completionRate: string;
  createdAt: string;
}

export interface P2pAd {
  id: string;
  ownerAddress: string;
  displayName?: string;
  kycVerified?: boolean;
  isMerchant?: boolean;
  completionRate?: string;
  token: "MC" | "USDT";
  side: "buy" | "sell";
  price: string;
  minAmount: string;
  maxAmount: string;
  availableAmount: string;
  paymentMethods: string[];
  paymentWindow: number;
  terms?: string;
  status: string;
  completedOrders: number;
  avgRating?: string;
  createdAt: string;
}

export interface PaymentDetail {
  id: string;
  ownerAddress: string;
  paymentMethod: string;
  label: string;
  details: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface P2pOrder {
  id: string;
  adId: string;
  buyerAddress: string;
  sellerAddress: string;
  token: "MC" | "USDT";
  side: "buy" | "sell";
  cryptoAmount: string;
  fiatAmount: string;
  price: string;
  paymentMethod: string;
  paymentDetails?: string;
  sellerPaymentDetail?: PaymentDetail | null;
  status: "pending" | "paid" | "released" | "cancelled" | "disputed" | "resolved";
  escrowStatus: "none" | "locked" | "released" | "refunded";
  escrowTxHash?: string;
  releaseTxHash?: string;
  escrowLockedAt?: string;
  paymentDeadline: string;
  paidAt?: string;
  releasedAt?: string;
  cancelledAt?: string;
  disputeResolvedFor?: "buyer" | "seller" | null;
  ad?: P2pAd;
  buyerProfile?: P2pProfile;
  sellerProfile?: P2pProfile;
  createdAt: string;
}

export interface EscrowInfo {
  configured: boolean;
  escrowAddress: string | null;
  usdtContractAddress: string | null;
}

export interface P2pMessage {
  id: string;
  orderId: string;
  senderAddress: string;
  content: string;
  imageUrl?: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface P2pAdsPage {
  ads: P2pAd[];
  total: number;
  limit: number;
  offset: number;
}

export interface P2pOrdersPage {
  orders: P2pOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface P2pDispute {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  description: string;
  status: "open" | "resolved_buyer" | "resolved_seller";
  createdAt: string;
}

// ── Address conversion helpers ────────────────────────────────────────────────

const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/i;

/** Convert a 0x ETH address to GMI Bech32 for display. Pass-through for non-ETH values. */
function toMxc(addr: string): string {
  if (!addr) return addr;
  if (ETH_ADDR_RE.test(addr)) return ethAddressToMxc(addr);
  return addr;
}

function cvtProfile(p: P2pProfile): P2pProfile {
  return { ...p, mxcAddress: toMxc(p.mxcAddress) };
}

function cvtAd(ad: P2pAd): P2pAd {
  return { ...ad, ownerAddress: toMxc(ad.ownerAddress) };
}

function cvtPaymentDetail(pd: PaymentDetail): PaymentDetail {
  return { ...pd, ownerAddress: toMxc(pd.ownerAddress) };
}

function cvtOrder(o: P2pOrder): P2pOrder {
  return {
    ...o,
    buyerAddress: toMxc(o.buyerAddress),
    sellerAddress: toMxc(o.sellerAddress),
    ad: o.ad ? cvtAd(o.ad) : o.ad,
    buyerProfile: o.buyerProfile ? cvtProfile(o.buyerProfile) : o.buyerProfile,
    sellerProfile: o.sellerProfile ? cvtProfile(o.sellerProfile) : o.sellerProfile,
    sellerPaymentDetail: o.sellerPaymentDetail ? cvtPaymentDetail(o.sellerPaymentDetail) : o.sellerPaymentDetail,
  };
}

function cvtMessage(m: P2pMessage): P2pMessage {
  return { ...m, senderAddress: toMxc(m.senderAddress) };
}

function cvtDispute(d: P2pDispute): P2pDispute {
  return { ...d, openedBy: toMxc(d.openedBy) };
}

function cvtEscrowInfo(info: EscrowInfo): EscrowInfo {
  return { ...info, escrowAddress: info.escrowAddress ? toMxc(info.escrowAddress) : null };
}

// ── API base URL ──────────────────────────────────────────────────────────────

function getApiBase(): string {
  // Web: use domain env or relative path
  if (Platform.OS === "web") {
    const domain = typeof process !== "undefined" ? process.env.EXPO_PUBLIC_DOMAIN : undefined;
    if (domain) return `https://${domain}/api/p2p`;
    return "/api/p2p";
  }
  // Native: P2P lives on the VPS, not the chain node
  return `${getPublicApiBase()}/p2p`;
}

async function req<T>(path: string, options?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const base = getApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
      signal: controller.signal,
      ...options,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Request failed");
      let msg = text;
      try { msg = (JSON.parse(text) as { error?: string; message?: string }).error ?? (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* use raw */ }
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out — check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const p2pApi = {
  // ── Profile ──────────────────────────────────────────────────────────────
  getProfile: async (address: string) => cvtProfile(await req<P2pProfile>(`/profiles/${address}`, {}, 5_000)),
  upsertProfile: async (body: { mxcAddress: string; displayName: string; phone?: string }) =>
    cvtProfile(await req<P2pProfile>("/profiles", { method: "POST", body: JSON.stringify(body) })),
  submitKyc: async (body: { mxcAddress: string; kycName: string; kycDocType: string; displayName: string; kycDocImage?: string }) =>
    cvtProfile(await req<P2pProfile>("/profiles/kyc", { method: "POST", body: JSON.stringify(body) })),
  disconnectProfile: (address: string) =>
    req<{ ok: boolean }>(`/profiles/${address}`, { method: "DELETE" }),

  // ── Ads ──────────────────────────────────────────────────────────────────
  getAds: async (params: { token?: string; side?: string; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params.token) qs.set("token", params.token);
    if (params.side) qs.set("side", params.side);
    if (params.offset) qs.set("offset", String(params.offset));
    const page = await req<P2pAdsPage>(`/ads?${qs.toString()}`);
    return { ...page, ads: page.ads.map(cvtAd) };
  },
  getMyAds: async (address: string) => {
    const page = await req<P2pAdsPage>(`/ads?owner=${address}`);
    return { ...page, ads: page.ads.map(cvtAd) };
  },
  postAd: async (body: {
    ownerAddress: string; token: string; side: string; price: string;
    minAmount: string; maxAmount: string; availableAmount: string;
    paymentMethods: string[]; paymentWindow: number; terms?: string;
    escrowTxHash?: string;
  }) => cvtAd(await req<P2pAd>("/ads", { method: "POST", body: JSON.stringify(body) })),
  updateAdStatus: (id: string, status: string) =>
    req<P2pAd>(`/ads/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  cancelAd: (id: string, ownerAddress: string) =>
    req<P2pAd & { refundTxHash: string | null }>(`/ads/${id}/cancel`, { method: "POST", body: JSON.stringify({ ownerAddress }) }),

  // ── Orders ───────────────────────────────────────────────────────────────
  getMyOrders: async (address: string, offset = 0) => {
    const page = await req<P2pOrdersPage>(`/orders?address=${encodeURIComponent(address)}&offset=${offset}`);
    return { ...page, orders: page.orders.map(cvtOrder) };
  },
  getOrder: async (id: string) => cvtOrder(await req<P2pOrder>(`/orders/${id}`)),
  createOrder: async (body: {
    adId: string; buyerAddress: string; cryptoAmount: string;
    paymentMethod: string; paymentDetails?: string; escrowTxHash?: string;
  }) => cvtOrder(await req<P2pOrder>("/orders", { method: "POST", body: JSON.stringify(body) })),
  markPaid: async (id: string, address: string) =>
    cvtOrder(await req<P2pOrder>(`/orders/${id}/pay`, { method: "POST", body: JSON.stringify({ address }) })),
  confirmRelease: async (id: string, address: string) =>
    cvtOrder(await req<P2pOrder>(`/orders/${id}/release`, { method: "POST", body: JSON.stringify({ address }) })),
  lockEscrow: async (id: string, sellerAddress: string, txHash: string) =>
    cvtOrder(await req<P2pOrder>(`/orders/${id}/lock-escrow`, { method: "POST", body: JSON.stringify({ sellerAddress, txHash }) })),
  getEscrowInfo: async () => cvtEscrowInfo(await req<EscrowInfo>("/escrow/info")),
  cancelOrder: async (id: string, address: string, reason?: string) =>
    cvtOrder(await req<P2pOrder>(`/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ address, reason }) })),

  // ── Messages ─────────────────────────────────────────────────────────────
  getMessages: async (orderId: string) => {
    const msgs = await req<P2pMessage[]>(`/orders/${orderId}/messages`);
    return msgs.map(cvtMessage);
  },
  sendMessage: async (orderId: string, body: { senderAddress: string; content?: string; imageUrl?: string }) =>
    cvtMessage(await req<P2pMessage>(`/orders/${orderId}/messages`, { method: "POST", body: JSON.stringify(body) })),

  // ── Disputes ─────────────────────────────────────────────────────────────
  getDispute: async (orderId: string) => cvtDispute(await req<P2pDispute>(`/orders/${orderId}/dispute`)),
  openDispute: async (orderId: string, body: { openedBy: string; reason: string; description: string; evidence?: string }) =>
    cvtDispute(await req<P2pDispute>(`/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify(body) })),

  // ── Ratings ──────────────────────────────────────────────────────────────
  rateOrder: (orderId: string, body: { raterAddress: string; ratedAddress: string; score: number; comment?: string }) =>
    req<{ ok: boolean }>(`/orders/${orderId}/rate`, { method: "POST", body: JSON.stringify(body) }),

  // ── Market price & wallet balance ─────────────────────────────────────────
  getMarketPrice: async (token: string, side: string): Promise<{ lowestPrice: number | null; highestPrice: number | null; count: number }> => {
    const qs = new URLSearchParams({ token, side });
    return req(`/market-price?${qs.toString()}`);
  },
  getWalletBalance: async (address: string): Promise<{ mc: string; usdt: string }> => {
    return req(`/wallet-balance/${encodeURIComponent(address)}`);
  },

  // ── Payment Details ───────────────────────────────────────────────────────
  getPaymentDetails: async (address: string) => {
    const rows = await req<PaymentDetail[]>(`/payment-details/${address}`);
    return rows.map(cvtPaymentDetail);
  },
  getPaymentDetailForMethod: async (address: string, method: string) => {
    const rows = await req<PaymentDetail[]>(`/payment-details/${address}/${encodeURIComponent(method)}`);
    return rows.map(cvtPaymentDetail);
  },
  savePaymentDetail: async (body: { ownerAddress: string; paymentMethod: string; label?: string; details: Record<string, string> }) =>
    cvtPaymentDetail(await req<PaymentDetail>("/payment-details", { method: "POST", body: JSON.stringify(body) })),
  deletePaymentDetail: (id: string, ownerAddress: string) =>
    req<{ ok: boolean }>(`/payment-details/${id}`, { method: "DELETE", body: JSON.stringify({ ownerAddress }) }),
};
