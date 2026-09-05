import AsyncStorage from "@react-native-async-storage/async-storage";
import { GMI_CHAIN_ID, GMI_RPC_URL } from "./chain";

export const DEFAULT_NODE_URL = GMI_RPC_URL;

const STORAGE_KEY = "mchain_node_url_v1";

let _cached: string = DEFAULT_NODE_URL;
let _initialized = false;

export async function initNodeUrl(): Promise<void> {
  if (_initialized) return;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) _cached = stored;
  } catch {
    // fall back to default
  }
  _initialized = true;
}

export function getNodeUrl(): string {
  return _cached;
}

export function isDefaultNode(): boolean {
  return _cached === DEFAULT_NODE_URL;
}

export async function setNodeUrl(url: string): Promise<void> {
  const cleaned = url.trim().replace(/\/$/, "");
  _cached = cleaned;
  await AsyncStorage.setItem(STORAGE_KEY, cleaned);
}

export async function resetNodeUrl(): Promise<void> {
  _cached = DEFAULT_NODE_URL;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function testNodeConnection(url: string): Promise<number> {
  const cleaned = url.trim().replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const start = Date.now();
  try {
    const res = await fetch(cleaned, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { result?: string };
    if (data.result?.toLowerCase() !== `0x${GMI_CHAIN_ID.toString(16)}`) {
      throw new Error("RPC is not GMI Chain");
    }
    return Date.now() - start;
  } finally {
    clearTimeout(timer);
  }
}

// Auto-initialize on first import so getNodeUrl() is ready before any API call
void initNodeUrl();
