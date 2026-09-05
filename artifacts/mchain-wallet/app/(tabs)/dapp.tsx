import { Icon } from "@/components/Icon";
import { useWallet } from "@/context/WalletContext";
import { useColors } from "@/hooks/useColors";
import { getNodeUrl } from "@/services/node";
import { api, type FeaturedDapp } from "@/services/api";
import { useQuery } from "@tanstack/react-query";
import {
  hexToBytes,
  signLegacyTransaction,
  signPersonalMessage,
  weiToMc,
} from "@/services/crypto";
import {
  GMI_CHAIN_ID,
  GMI_CHAIN_ID_HEX,
  GMI_CHAIN_NAME,
  GMI_GAS_PRICE_WEI,
  GMI_NATIVE_SYMBOL,
} from "@/services/chain";

/** Format a wei amount as GMI with enough decimals to always show non-zero.
 *  Rules: ≥1 → 4dp | ≥0.0001 → 6dp | ≥0.000001 → 8dp | smaller → 10dp */
function formatMcAuto(wei: bigint): string {
  try {
    const divisor = 1_000_000_000_000_000_000n;
    const whole = Number(wei / divisor);
    const frac  = Number(wei % divisor) / 1e18;
    const total = whole + frac;
    if (total === 0) return "0";
    if (total >= 1)       return total.toFixed(4);
    if (total >= 0.0001)  return total.toFixed(6);
    if (total >= 0.000001) return total.toFixed(8);
    return total.toFixed(10);
  } catch {
    return "0";
  }
}
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";

import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

// ── History ────────────────────────────────────────────────────────────────────
const HISTORY_KEY = "dapp_browser_history_v1";
const MAX_HISTORY = 20;
const HISTORY_PREVIEW = 4;

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

// ── Chain constants ────────────────────────────────────────────────────────────
const CHAIN_ID_HEX = GMI_CHAIN_ID_HEX;
const CHAIN_ID_DEC = String(GMI_CHAIN_ID);
const CHAIN_NAME = GMI_CHAIN_NAME;


// ── Injected provider script (runs before page JS) ────────────────────────────
// ALL non-static calls are bridged to React Native via postMessage.
// React Native owns the fetch to GMI's RPC — no WebView-side networking.
// This avoids WebView network quirks and lets RN normalise every response.
function buildProviderScript(ethAddress: string | null): string {
  const accounts = ethAddress ? JSON.stringify([ethAddress.toLowerCase()]) : "[]";
  return `
(function() {
  if (window.ethereum && (window.ethereum._isGmiWallet || window.ethereum._isMChain)) return;

  var _accounts = ${accounts};
  var _pending  = {};
  var _listeners = {};

  function emit(event, data) {
    (_listeners[event] || []).forEach(function(fn) {
      try { fn(data); } catch(e) {}
    });
  }

  // ── Called by React Native ────────────────────────────────────────────────
  window.__mcResolve = function(id, result) {
    var cb = _pending[id];
    if (!cb) return;
    delete _pending[id];
    cb.resolve(result);
  };
  window.__mcReject = function(id, code, message) {
    var cb = _pending[id];
    if (!cb) return;
    delete _pending[id];
    // Build a proper EIP-1193 ProviderRpcError so viem can classify it.
    var err = new Error(message || 'Request failed.');
    err.code = typeof code === 'number' ? code : 4001;
    err.data = { code: err.code, message: err.message };
    cb.reject(err);
  };
  window.__mcEmit = function(event, data) {
    if (event === 'accountsChanged') {
      _accounts = data || [];
      ethereum.selectedAddress = _accounts[0] || null;
    }
    emit(event, data);
  };

  // ── Bridge helper ─────────────────────────────────────────────────────────
  function bridge(method, params) {
    return new Promise(function(resolve, reject) {
      var id = 'mc_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
      _pending[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ id: id, method: method, params: params || [] })
      );
    });
  }

  // ── Provider object ───────────────────────────────────────────────────────
  var ethereum = {
    isMetaMask: true,
    isGmiWallet: true,
    isMChainWallet: true,
    _isGmiWallet: true,
    _isMChain: true,
    chainId: '${CHAIN_ID_HEX}',
    networkVersion: '${CHAIN_ID_DEC}',
    selectedAddress: _accounts[0] || null,

    request: function(payload) {
      var method = payload.method;
      var params = payload.params || [];

      // Answered immediately — no bridge needed
      if (method === 'eth_chainId')  return Promise.resolve('${CHAIN_ID_HEX}');
      if (method === 'net_version')  return Promise.resolve('${CHAIN_ID_DEC}');
      if (method === 'eth_accounts') return Promise.resolve(_accounts.slice());

      // Everything else goes to React Native (wallet ops + RPC proxy)
      return bridge(method, params);
    },

    on: function(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
      return this;
    },
    removeListener: function(event, fn) {
      if (_listeners[event])
        _listeners[event] = _listeners[event].filter(function(f) { return f !== fn; });
      return this;
    },
    off: function(event, fn) { return this.removeListener(event, fn); },

    // Legacy compatibility
    enable: function() { return this.request({ method: 'eth_requestAccounts' }); },
    sendAsync: function(payload, cb) {
      this.request({ method: payload.method, params: payload.params || [] })
        .then(function(r) { cb(null, { id: payload.id, jsonrpc: '2.0', result: r }); })
        .catch(function(e) { cb(e); });
    },
    send: function(m, p) {
      if (typeof m === 'string') return this.request({ method: m, params: p || [] });
      return this.request({ method: m.method, params: m.params || [] });
    },
  };

  window.ethereum = ethereum;
  if (!window.web3) window.web3 = {};
  window.web3.currentProvider = ethereum;
})();
true;
`;
}

// ── Featured dApps ─────────────────────────────────────────────────────────────
// Featured DApps are loaded from the API — managed by admin panel

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "https://" + t;
}

function shortAddr(addr: string): string {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ── Pending request types ──────────────────────────────────────────────────────
interface ConnectReq { id: string; origin: string }
interface SignReq { id: string; message: string; address: string; origin: string }
interface SendTxReq {
  id: string;
  to: string;
  value: string;
  data: string;
  gas: string;
  origin: string;
}

// ── Featured Projects component ────────────────────────────────────────────────
function FeaturedProjectsSkeleton({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ marginTop: 4, marginBottom: 32 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginHorizontal: 20, marginBottom: 16 }}>
        <View>
          <View style={{ width: 130, height: 10, borderRadius: 5, backgroundColor: colors.border, marginBottom: 6 }} />
          <View style={{ width: 90, height: 12, borderRadius: 5, backgroundColor: colors.border }} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 14, gap: 10 }}>
        {[1, 2].map(i => (
          <View key={i} style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.border }} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ width: "50%", height: 13, borderRadius: 5, backgroundColor: colors.border }} />
              <View style={{ width: "80%", height: 11, borderRadius: 5, backgroundColor: colors.border }} />
            </View>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.border }} />
          </View>
        ))}
      </View>
    </View>
  );
}

function FeaturedProjects({
  dapps,
  loading,
  onOpen,
  colors,
}: {
  dapps: FeaturedDapp[];
  loading?: boolean;
  onOpen: (dapp: FeaturedDapp) => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (loading) return <FeaturedProjectsSkeleton colors={colors} />;
  if (dapps.length === 0) return null;

  const activeCount = dapps.filter((d) => !d.comingSoon).length;
  const isDark = colors.background === "#0A0E14" || colors.background < "#888888";

  return (
    <View style={{ marginTop: 4, marginBottom: 32 }}>
      {/* ── Section header ── */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginHorizontal: 20, marginBottom: 16 }}>
        <View>
          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5, marginBottom: 3 }}>
            FEATURED PROJECTS
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground }}>
            {activeCount} live · {dapps.length - activeCount} coming soon
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#10B98112", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#10B98130" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" }} />
          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#10B981" }}>GMI Chain</Text>
        </View>
      </View>

      {/* ── Cards ── */}
      <View style={{ paddingHorizontal: 14, gap: 10 }}>
        {dapps.map((dapp) => {
          const isComingSoon = dapp.comingSoon;

          const cardContent = (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: isComingSoon ? colors.border + "60" : colors.border,
                overflow: "hidden",
              }}
            >
              {/* Main row */}
              <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14, opacity: isComingSoon ? 0.55 : 1 }}>
                {/* Icon */}
                <View

                  style={{ width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: dapp.color + "25" }}
                >
                  <Icon name={dapp.icon as Parameters<typeof Icon>[0]["name"]} size={26} color={isComingSoon ? colors.mutedForeground : dapp.color} />
                </View>

                {/* Text block */}
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: isComingSoon ? colors.mutedForeground : colors.foreground }} numberOfLines={1}>
                      {dapp.name}
                    </Text>
                    {isComingSoon && (
                      <View style={{ backgroundColor: "#F59E0B18", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: "#F59E0B40" }}>
                        <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#F59E0B", letterSpacing: 0.8 }}>SOON</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 17 }} numberOfLines={2}>
                    {dapp.description}
                  </Text>
                </View>

                {/* Action */}
                {isComingSoon ? (
                  <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
                    <Icon name="time-outline" size={18} color={colors.mutedForeground} />
                  </View>
                ) : (
                  <View

                    style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="arrow-forward" size={16} color="#FFF" />
                  </View>
                )}
              </View>

              {/* Coming soon footer strip */}
              {isComingSoon && (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border + "50", backgroundColor: colors.background + "80" }}>
                  <BlurView intensity={isDark ? 18 : 12} tint={isDark ? "dark" : "light"} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9 }}>
                    <Icon name="time-outline" size={13} color="#F59E0B" />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#F59E0B", letterSpacing: 0.5 }}>Launching Soon</Text>
                  </BlurView>
                </View>
              )}
            </View>
          );

          return isComingSoon ? (
            <View key={dapp.id}>{cardContent}</View>
          ) : (
            <TouchableOpacity key={dapp.id} activeOpacity={0.76} onPress={() => onOpen(dapp)}>
              {cardContent}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function DAppScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { url: deepLinkUrl } = useLocalSearchParams<{ url?: string }>();
  const { ethAddress, getPrivateKey } = useWallet();

  const dappScrollRef = useRef<ScrollView>(null);

  // ── Browser state ────────────────────────────────────────────────────────────
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [displayUrl, setDisplayUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);

  // Scroll the dApp home page to top whenever the tab is focused and no URL is open
  useFocusEffect(
    useCallback(() => {
      if (!activeUrl) {
        dappScrollRef.current?.scrollTo({ y: 0, animated: false });
      }
    }, [activeUrl])
  );

  // ── Featured DApps from API ──────────────────────────────────────────────────
  const { data: featuredDapps = [], isLoading: dappsLoading } = useQuery({
    queryKey: ["featuredDapps"],
    queryFn: () => api.getFeaturedDapps(),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });

  // ── History state ────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // ── Wallet connection state ──────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);

  // ── Pending modals ───────────────────────────────────────────────────────────
  const [connectReq, setConnectReq] = useState<ConnectReq | null>(null);
  const [signReq, setSignReq] = useState<SignReq | null>(null);
  const [sendTxReq, setSendTxReq] = useState<SendTxReq | null>(null);
  const [txBusy, setTxBusy] = useState(false);

  const webViewRef = useRef<WebView>(null);

  // ── Load history on mount ────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
      if (raw) {
        try { setHistory(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  // ── Hide tab bar while browser is active ─────────────────────────────────────
  // We only call setOptions when the browser actually opens/closes.
  // Setting tabBarStyle:undefined on every mount would clear the screenOptions
  // styling and leave a white/default background — so we guard with a ref.
  const tabBarHiddenRef = useRef(false);
  const isWeb = Platform.OS === "web";
  useEffect(() => {
    if (activeUrl) {
      tabBarHiddenRef.current = true;
      navigation.setOptions({ tabBarStyle: { display: "none" } });
    } else if (tabBarHiddenRef.current) {
      tabBarHiddenRef.current = false;
      // Restore the exact same style defined in _layout.tsx screenOptions
      navigation.setOptions({
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.OS === "ios" ? "transparent" : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          paddingBottom: isWeb ? 0 : insets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
      });
    }
  }, [activeUrl, navigation, colors, insets, isWeb]);

  // ── History helpers ──────────────────────────────────────────────────────────
  async function saveToHistory(url: string, title: string) {
    const entry: HistoryEntry = { url, title, visitedAt: Date.now() };
    const next = [entry, ...history.filter((h) => h.url !== url)].slice(0, MAX_HISTORY);
    setHistory(next);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  async function removeFromHistory(url: string) {
    const next = history.filter((h) => h.url !== url);
    setHistory(next);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  async function clearHistory() {
    setHistory([]);
    setShowAllHistory(false);
    await AsyncStorage.removeItem(HISTORY_KEY);
  }

  // ── WebView helpers ──────────────────────────────────────────────────────────
  function runInWebView(js: string) {
    webViewRef.current?.injectJavaScript(js + "; true;");
  }
  function resolveRequest(id: string, result: unknown) {
    runInWebView(`window.__mcResolve(${JSON.stringify(id)}, ${JSON.stringify(result)})`);
  }
  function rejectRequest(id: string, code = 4001, msg = "User rejected the request.") {
    runInWebView(`window.__mcReject(${JSON.stringify(id)}, ${code}, ${JSON.stringify(msg)})`);
  }
  function emitEvent(event: string, data: unknown) {
    runInWebView(`window.__mcEmit(${JSON.stringify(event)}, ${JSON.stringify(data)})`);
  }

  // ── Origin helper ─────────────────────────────────────────────────────────
  function originOf(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  // ── WebView message handler ──────────────────────────────────────────────────
  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: { id: string; method: string; params: unknown[] };
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    const { id, method, params } = msg;
    const origin = originOf(displayUrl);

    switch (method) {
      // ── Connection ──────────────────────────────────────────────────────────
      case "eth_requestAccounts":
      case "wallet_requestPermissions": {
        if (isConnected && ethAddress) {
          // Already connected — return immediately
          resolveRequest(id, method === "wallet_requestPermissions"
            ? [{ parentCapability: "eth_accounts" }]
            : [ethAddress.toLowerCase()]);
          return;
        }
        setConnectReq({ id, origin });
        break;
      }

      case "wallet_getPermissions": {
        if (isConnected) {
          resolveRequest(id, [{ parentCapability: "eth_accounts" }]);
        } else {
          resolveRequest(id, []);
        }
        break;
      }

      case "wallet_switchEthereumChain": {
        // We only support GMI Chain — always "switch" to it
        resolveRequest(id, null);
        break;
      }

      case "wallet_addEthereumChain": {
        resolveRequest(id, null);
        break;
      }

      // ── Sign ────────────────────────────────────────────────────────────────
      case "personal_sign":
      case "eth_sign": {
        if (!ethAddress) { rejectRequest(id); return; }
        // personal_sign params: [message, address] or [address, message]
        // eth_sign params: [address, message]
        const p = params as string[];
        let message = p[0];
        let addr = p[1];
        // If p[0] looks like an address (0x + 40 hex chars), swap
        if (/^0x[0-9a-f]{40}$/i.test(p[0]) && p[1] && p[1].length > 42) {
          message = p[1]; addr = p[0];
        }
        // Decode message for display (keep raw for signing)
        let displayMsg = message;
        try {
          if (message.startsWith("0x")) {
            displayMsg = Buffer.from(message.slice(2), "hex").toString("utf8");
          }
        } catch { /* keep original */ }
        signReqRaw.current = message; // raw (possibly hex) used for actual signing
        setSignReq({ id, message: displayMsg, address: addr ?? ethAddress, origin });
        break;
      }

      case "eth_signTypedData":
      case "eth_signTypedData_v1":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        // Typed data signing — show a simplified modal
        const p = params as [string, unknown];
        const addr2 = p[0];
        const typedData = p[1];
        const displayMsg2 = typeof typedData === "string" ? typedData : JSON.stringify(typedData, null, 2);
        signReqRaw.current = typeof typedData === "string" ? typedData : JSON.stringify(typedData);
        setSignReq({ id, message: displayMsg2, address: addr2, origin });
        break;
      }

      // ── Send Transaction ─────────────────────────────────────────────────────
      case "eth_sendTransaction": {
        if (!ethAddress) { rejectRequest(id); return; }
        const tx = (params as Record<string, string>[])[0] ?? {};
        // DApps may send gasLimit (EIP-1559 name) or gas (legacy name) — accept both.
        // Fall back to a generous default (600 000) suitable for contract calls.
        setSendTxReq({
          id,
          to: tx.to ?? "",
          value: tx.value ?? "0x0",
          data: tx.data ?? "0x",
          gas: tx.gasLimit ?? tx.gas ?? "0x927C0",
          origin,
        });
        break;
      }

      default: {
        // ── RPC proxy ─────────────────────────────────────────────────────────
        // All non-wallet methods are proxied through React Native so we can:
        //  • normalise compatible responses (bech32 miner field, etc.)
        //  • fix eth_estimateGas always returning 21 000 for contract calls
        //  • avoid WebView-side networking issues (CORS timing, SSL stack, etc.)
        const rpcUrl = getNodeUrl();
        try {
          const rpcRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }).then(r => r.json());

          if (rpcRes.error) {
            rejectRequest(id, rpcRes.error.code ?? -32603, rpcRes.error.message ?? "RPC error");
            return;
          }

          let result = rpcRes.result;

          // ── Normalise compatible block format ───────────────────────────────
          // Compatible nodes may return miner as bech32 ("gmi1qqq…").
          if (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash") {
            if (result && typeof result.miner === "string" && !result.miner.startsWith("0x")) {
              result = { ...result, miner: "0x0000000000000000000000000000000000000000" };
            }
          }

          // ── Fix eth_estimateGas always returning 21 000 ──────────────────────
          // Compatible RPCs may not simulate gas — use the intrinsic
          // minimum (21 000). For contract calls (non-empty data) this is far
          // too low. Return 600 000 as a safe minimum so viem passes enough
          // gas in eth_sendTransaction and the transaction doesn't revert OOG.
          if (method === "eth_estimateGas") {
            const reqTx = ((params as unknown[])[0] ?? {}) as Record<string, string>;
            const hasData = reqTx.data && reqTx.data !== "0x";
            const estimated = parseInt(String(result ?? "0x5208"), 16);
            if (hasData && estimated <= 21000) {
              result = "0x927C0"; // 600 000
            }
          }

          resolveRequest(id, result);
        } catch (e) {
          console.error("[DApp RPC proxy]", method, e);
          rejectRequest(id, -32603, e instanceof Error ? e.message : "Network error");
        }
        break;
      }
    }
  }, [displayUrl, isConnected, ethAddress]);

  // Ref to hold the raw (possibly hex) message for personal_sign
  const signReqRaw = useRef<string>("");

  // ── Navigation ───────────────────────────────────────────────────────────────
  // saveHistory=true only when the user typed a URL themselves in the address bar
  function openDApp(url: string, options?: { saveHistory?: boolean; title?: string }) {
    const target = normalizeUrl(url);
    if (!target) return;
    Keyboard.dismiss();
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.open(target, "_blank");
      return;
    }
    setDisplayUrl(target);
    setActiveUrl(target);
    setCanGoBack(false);
    setCanGoForward(false);
    setIsConnected(false);
    if (options?.saveHistory) {
      const domain = (() => { try { return new URL(target).hostname; } catch { return target; } })();
      saveToHistory(target, options.title ?? domain);
    }
  }

  // ── Deep-link handler: mchain-wallet://dapp?url=https://... ──────────────────
  useEffect(() => {
    if (!deepLinkUrl) return;
    const target = decodeURIComponent(deepLinkUrl);
    openDApp(target, { saveHistory: true });
    // Clear the param so re-focusing the tab doesn't re-trigger
    router.setParams({ url: undefined });
  }, [deepLinkUrl]);

  function handleNavStateChange(nav: WebViewNavigation) {
    setCanGoBack(nav.canGoBack);
    setCanGoForward(nav.canGoForward);
    if (nav.url) setDisplayUrl(nav.url);
    // Keep spinner in sync with the WebView's actual loading state.
    // onLoadEnd alone misses redirects and client-side navigation events.
    setLoading(nav.loading);
  }

  function handleClose() {
    setActiveUrl(null);
    setDisplayUrl("");
    setUrlInput("");
    setCanGoBack(false);
    setCanGoForward(false);
    setLoading(false);
    setIsConnected(false);
    setConnectReq(null);
    setSignReq(null);
    setSendTxReq(null);
  }

  // ── Connect approval ──────────────────────────────────────────────────────────
  function approveConnect() {
    if (!connectReq || !ethAddress) return;
    const addr = ethAddress.toLowerCase();
    if (connectReq.id.startsWith("wallet_")) {
      resolveRequest(connectReq.id, [{ parentCapability: "eth_accounts" }]);
    } else {
      resolveRequest(connectReq.id, [addr]);
    }
    emitEvent("accountsChanged", [addr]);
    setIsConnected(true);
    setConnectReq(null);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
  function rejectConnect() {
    if (!connectReq) return;
    rejectRequest(connectReq.id, 4001, "User rejected the connection request.");
    setConnectReq(null);
  }

  // ── Sign approval ─────────────────────────────────────────────────────────────
  async function approveSign() {
    if (!signReq) return;
    const pk = await getPrivateKey();
    if (!pk) { rejectRequest(signReq.id, 4001, "No private key available"); setSignReq(null); return; }
    try {
      const rawMsg = signReqRaw.current || signReq.message;
      const sig = signPersonalMessage(rawMsg, pk);
      resolveRequest(signReq.id, sig);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      rejectRequest(signReq.id, -32603, e instanceof Error ? e.message : "Signing failed");
    }
    setSignReq(null);
  }
  function rejectSign() {
    if (!signReq) return;
    rejectRequest(signReq.id, 4001, "User rejected the signing request.");
    setSignReq(null);
  }

  // ── Send Tx approval ──────────────────────────────────────────────────────────
  async function approveSendTx() {
    if (!sendTxReq || !ethAddress) return;
    setTxBusy(true);
    try {
      const pk = await getPrivateKey();
      if (!pk) throw new Error("No private key");
      const rpcUrl = getNodeUrl();

      // ── Diagnostic: verify account exists and has balance ─────────────────
      const [nonceRes, balanceRes] = await Promise.all([
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [ethAddress, "latest"] }),
        }).then(r => r.json()),
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "eth_getBalance", params: [ethAddress, "latest"] }),
        }).then(r => r.json()),
      ]);
      const nonce = parseInt(nonceRes.result ?? "0x0", 16);
      const balanceWei = BigInt(balanceRes.result ?? "0x0");

      console.log("[DApp TX] from:", ethAddress, "nonce:", nonce, "balance:", balanceWei.toString());

      if (balanceWei === 0n) {
        throw new Error(
          `EVM account not funded.\n\nYour EVM address:\n${ethAddress}\n\nSend GMI to this address before sending DApp transactions.`
        );
      }

      const valueWei = BigInt(sendTxReq.value === "0x" ? "0x0" : sendTxReq.value);
      // Convert hex calldata to bytes; ignore "0x" / empty
      const dataHex = sendTxReq.data && sendTxReq.data !== "0x" ? sendTxReq.data : "";
      const dataBytes = dataHex ? hexToBytes(dataHex.replace(/^0x/i, "")) : new Uint8Array(0);
      // Use legacy (Type 0) EIP-155 transaction — universally supported on all
      // EVM chains including Cosmos-based ones that reject EIP-1559 Type-2 txs.
      // GMI currently reports a 1 Gwei gas price.
      const signed = signLegacyTransaction(sendTxReq.to, valueWei, nonce, pk, {
        gasLimit: BigInt(parseInt(sendTxReq.gas || "0x927C0", 16)),
        data: dataBytes,
      });

      console.log("[DApp TX] signed:", signed.slice(0, 64), "...");

      const sendRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_sendRawTransaction", params: [signed] }),
      }).then(r => r.json());

      console.log("[DApp TX] sendRes:", JSON.stringify(sendRes));

      if (sendRes.error) {
        const detail = sendRes.error.data ? `\n\nData: ${JSON.stringify(sendRes.error.data)}` : "";
        throw new Error(sendRes.error.message + detail);
      }
      resolveRequest(sendTxReq.id, sendRes.result);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSendTxReq(null);
    } catch (e) {
      rejectRequest(sendTxReq.id, -32603, e instanceof Error ? e.message : "Transaction failed");
      setSendTxReq(null);
      Alert.alert("Transaction Failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTxBusy(false);
    }
  }
  function rejectSendTx() {
    if (!sendTxReq) return;
    rejectRequest(sendTxReq.id, 4001, "User rejected the transaction.");
    setSendTxReq(null);
  }

  // ── Styles ────────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // Home screen
    homeScroll: { paddingBottom: 40 + insets.bottom },
    header: { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingHorizontal: 20, paddingBottom: 20 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    title: { fontSize: 26, fontFamily: "Inter_700Bold", color: colors.foreground, letterSpacing: -0.3 },
    subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    networkPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#10B98112", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#10B98130" },
    networkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" },
    networkText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#10B981" },

    searchWrap: { marginHorizontal: 20, marginBottom: 24 },
    searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 16, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
    input: { flex: 1, paddingVertical: 15, fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground },
    goBtn: { width: 36, height: 36, borderRadius: 12, overflow: "hidden" as const },
    goBtnGrad: { width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const },

    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20, marginBottom: 12 },
    sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.5 },
    sectionAction: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },

    grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 10, marginBottom: 8 },
    card: { width: "47%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
    cardIconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const },
    cardName: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground },
    cardDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 16 },
    openRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    openText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    comingSoonBadge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 2 },
    comingSoonText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },

    // Browser chrome
    browserChrome: { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 4), backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
    browserTopRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
    navBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    urlBar: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, height: 36, gap: 6 },
    urlText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: colors.foreground },
    homeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
    progressBar: { height: 2, backgroundColor: colors.primary },

    // Connected badge row
    connectedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border + "60" },
    connectedLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    connectedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#10B981" },
    connectedChain: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#10B981" },
    connectedAddr: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    disconnectBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    disconnectText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },

    // WebView
    webview: { flex: 1, backgroundColor: colors.background },

    // Modal overlay
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 4 },
    sheetHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
    sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center" },
    sheetSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginTop: 4 },
    originRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.background, borderRadius: 12, marginHorizontal: 20, marginBottom: 16, padding: 12 },
    originText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1 },
    infoBox: { backgroundColor: colors.background, borderRadius: 12, marginHorizontal: 20, marginBottom: 16, padding: 14 },
    infoLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2, marginBottom: 6 },
    infoValue: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 20 },
    infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    infoRowLast: { borderBottomWidth: 0 },
    infoRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    infoRowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, maxWidth: "60%" },
    btnRow: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 20, paddingTop: 4 },
    cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, alignItems: "center" },
    cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    confirmBtn: { flex: 1, borderRadius: 14, overflow: "hidden" as const },
    confirmGrad: { paddingVertical: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
    confirmText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    dangerBtn: { flex: 1, borderRadius: 14, overflow: "hidden" as const },
    dangerGrad: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
    dangerText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },

    // History
    historySection: { marginBottom: 20 },
    historySectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20, marginBottom: 10 },
    historyItem: { flexDirection: "row", alignItems: "center", marginHorizontal: 14, marginBottom: 8, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
    historyIconWrap: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primary + "10", borderWidth: 1, borderColor: colors.primary + "25", alignItems: "center", justifyContent: "center" },
    historyTextWrap: { flex: 1 },
    historyTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 2 },
    historyUrl: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    historyDelete: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    showMoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginVertical: 4, marginBottom: 16 },
    showMoreText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary },
    clearHistoryBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    clearHistoryText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
  });

  // ── In-app browser ────────────────────────────────────────────────────────────
  if (activeUrl) {
    const shortUrl = displayUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const injectedJS = buildProviderScript(isConnected ? ethAddress : null);

    return (
      <View style={s.container}>
        {/* ── Browser chrome ─────────────────────────────────────────── */}
        <View style={s.browserChrome}>
          <View style={s.browserTopRow}>
            <TouchableOpacity style={[s.navBtn, !canGoBack && { opacity: 0.35 }]} onPress={() => webViewRef.current?.goBack()} disabled={!canGoBack} activeOpacity={0.7}>
              <Icon name="arrow-back" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.navBtn, !canGoForward && { opacity: 0.35 }]} onPress={() => webViewRef.current?.goForward()} disabled={!canGoForward} activeOpacity={0.7}>
              <Icon name="arrow-forward" size={18} color={colors.foreground} />
            </TouchableOpacity>

            <View style={s.urlBar}>
              <Icon name="globe-outline" size={12} color={colors.mutedForeground} />
              <Text style={s.urlText} numberOfLines={1} ellipsizeMode="tail">{shortUrl}</Text>
              {loading && <ActivityIndicator size="small" color={colors.primary} />}
            </View>

            <TouchableOpacity style={s.navBtn} onPress={() => webViewRef.current?.reload()} activeOpacity={0.7}>
              <Icon name="refresh-outline" size={18} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.homeBtn} onPress={handleClose} activeOpacity={0.8}>
              <Icon name="home" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Connected chain badge */}
          {isConnected && ethAddress && (
            <View style={s.connectedRow}>
              <View style={s.connectedLeft}>
                <View style={s.connectedDot} />
                <Text style={s.connectedChain}>{CHAIN_NAME} · Chain {CHAIN_ID_DEC}</Text>
                <Text style={s.connectedAddr}>{shortAddr(ethAddress)}</Text>
              </View>
              <TouchableOpacity
                style={s.disconnectBtn}
                onPress={() => {
                  setIsConnected(false);
                  emitEvent("accountsChanged", []);
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                activeOpacity={0.7}
              >
                <Text style={s.disconnectText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          )}

          {loading && <View style={[s.progressBar, { opacity: 0.7 }]} />}
        </View>

        <WebView
          ref={webViewRef}
          source={{ uri: activeUrl }}
          style={s.webview}
          injectedJavaScriptBeforeContentLoaded={injectedJS}
          onMessage={handleMessage}
          onNavigationStateChange={handleNavStateChange}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mixedContentMode="compatibility"
        />

        {/* ── Connect approval modal ──────────────────────────────────── */}
        <Modal visible={!!connectReq} transparent animationType="slide" onRequestClose={rejectConnect}>
          <View style={s.overlay}>
            <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>Connect Wallet</Text>
                <Text style={s.sheetSubtitle}>This site wants to connect to your GMI Wallet</Text>
              </View>

              <View style={s.originRow}>
                <Icon name="globe-outline" size={18} color={colors.primary} />
                <Text style={s.originText}>{connectReq?.origin}</Text>
              </View>

              <View style={s.infoBox}>
                <View style={s.infoRow}>
                  <Text style={s.infoRowLabel}>Wallet</Text>
                  <Text style={s.infoRowValue} numberOfLines={1}>{ethAddress ? shortAddr(ethAddress) : "—"}</Text>
                </View>
                <View style={[s.infoRow, s.infoRowLast]}>
                  <Text style={s.infoRowLabel}>Network</Text>
                  <Text style={s.infoRowValue}>{CHAIN_NAME} (Chain {CHAIN_ID_DEC})</Text>
                </View>
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.cancelBtn} onPress={rejectConnect} activeOpacity={0.8}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.confirmBtn} onPress={approveConnect} activeOpacity={0.85}>
                  <View  style={s.confirmGrad}>
                    <Icon name="link-outline" size={16} color="#FFF" />
                    <Text style={s.confirmText}>Connect</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Sign approval modal ─────────────────────────────────────── */}
        <Modal visible={!!signReq} transparent animationType="slide" onRequestClose={rejectSign}>
          <View style={s.overlay}>
            <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>Sign Message</Text>
                <Text style={s.sheetSubtitle}>Review and approve the message below</Text>
              </View>

              <View style={s.originRow}>
                <Icon name="globe-outline" size={18} color={colors.primary} />
                <Text style={s.originText}>{signReq?.origin}</Text>
              </View>

              <View style={s.infoBox}>
                <Text style={s.infoLabel}>MESSAGE</Text>
                <Text style={s.infoValue} selectable numberOfLines={8}>
                  {signReq?.message}
                </Text>
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.cancelBtn} onPress={rejectSign} activeOpacity={0.8}>
                  <Text style={s.cancelText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dangerBtn} onPress={approveSign} activeOpacity={0.85}>
                  <View  style={s.dangerGrad}>
                    <Text style={s.dangerText}>Sign</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Send Tx approval modal ──────────────────────────────────── */}
        <Modal visible={!!sendTxReq} transparent animationType="slide" onRequestClose={rejectSendTx}>
          <View style={s.overlay}>
            <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>Confirm Transaction</Text>
                <Text style={s.sheetSubtitle}>{sendTxReq?.origin} wants to submit a transaction</Text>
              </View>

              <View style={s.infoBox}>
                <View style={s.infoRow}>
                  <Text style={s.infoRowLabel}>To</Text>
                  <Text style={s.infoRowValue} numberOfLines={1}>{sendTxReq ? shortAddr(sendTxReq.to) : ""}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoRowLabel}>Amount</Text>
                  <Text style={s.infoRowValue}>
                    {sendTxReq
                      ? formatMcAuto(BigInt(sendTxReq.value === "0x" || !sendTxReq.value ? "0" : sendTxReq.value))
                      : "0"} {GMI_NATIVE_SYMBOL}
                  </Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoRowLabel}>Gas Fee (est.)</Text>
                  <Text style={s.infoRowValue}>
                    {sendTxReq
                      ? formatMcAuto(BigInt(parseInt(sendTxReq.gas || "0x927C0", 16)) * GMI_GAS_PRICE_WEI)
                      : "0"} {GMI_NATIVE_SYMBOL}
                  </Text>
                </View>
                <View style={[s.infoRow, s.infoRowLast]}>
                  <Text style={s.infoRowLabel}>Network</Text>
                  <Text style={s.infoRowValue}>{CHAIN_NAME}</Text>
                </View>
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.cancelBtn} onPress={rejectSendTx} disabled={txBusy} activeOpacity={0.8}>
                  <Text style={s.cancelText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dangerBtn} onPress={approveSendTx} disabled={txBusy} activeOpacity={0.85}>
                  <View  style={s.dangerGrad}>
                    {txBusy
                      ? <ActivityIndicator color="#FFF" />
                      : <Text style={s.dangerText}>Confirm</Text>
                    }
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Home / dApp grid ──────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <ScrollView ref={dappScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={s.homeScroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerRow}>
            <Text style={s.title}>dApp Browser</Text>
            <View style={s.networkPill}>
              <View style={s.networkDot} />
              <Text style={s.networkText}>GMI Chain</Text>
            </View>
          </View>
          <Text style={s.subtitle}>Explore the GMI ecosystem</Text>
        </View>

        {/* ── Search bar ── */}
        <View style={s.searchWrap}>
          <View style={s.searchBar}>
            <Icon name="search-outline" size={17} color={colors.mutedForeground} />
            <TextInput
              style={s.input}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="Search or enter dApp URL…"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => openDApp(urlInput, { saveHistory: true })}
            />
            {urlInput.trim().length > 0 && (
              <TouchableOpacity style={s.goBtn} onPress={() => openDApp(urlInput, { saveHistory: true })} activeOpacity={0.85}>
                <View    style={s.goBtnGrad}>
                  <Icon name="arrow-forward" size={16} color="#FFF" />
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Recent history ── */}
        {history.length > 0 && (() => {
          const visible = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);
          return (
            <View style={s.historySection}>
              <View style={s.sectionRow}>
                <Text style={s.sectionLabel}>RECENT</Text>
                <TouchableOpacity style={s.clearHistoryBtn} onPress={clearHistory} activeOpacity={0.7}>
                  <Text style={s.clearHistoryText}>Clear all</Text>
                </TouchableOpacity>
              </View>

              {visible.map((entry) => {
                const domain = (() => { try { return new URL(entry.url).hostname; } catch { return entry.url; } })();
                return (
                  <TouchableOpacity
                    key={entry.url + entry.visitedAt}
                    style={s.historyItem}
                    onPress={() => openDApp(entry.url)}
                    activeOpacity={0.75}
                  >
                    <View style={s.historyIconWrap}>
                      <Icon name="globe-outline" size={16} color={colors.primary} />
                    </View>
                    <View style={s.historyTextWrap}>
                      <Text style={s.historyTitle} numberOfLines={1}>{entry.title}</Text>
                      <Text style={s.historyUrl} numberOfLines={1}>{domain}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.historyDelete}
                      onPress={() => removeFromHistory(entry.url)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Icon name="close" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}

              {history.length > HISTORY_PREVIEW && (
                <TouchableOpacity style={s.showMoreRow} onPress={() => setShowAllHistory(!showAllHistory)} activeOpacity={0.7}>
                  <Icon name={showAllHistory ? "chevron-up-outline" : "chevron-down-outline"} size={14} color={colors.primary} />
                  <Text style={s.showMoreText}>
                    {showAllHistory ? "Show less" : `Show ${history.length - HISTORY_PREVIEW} more`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {/* ── Featured Projects ── */}
        <FeaturedProjects
          // The Explorer shortcut is intentionally not shown in the wallet DApp browser.
          dapps={featuredDapps.filter((dapp) => !dapp.name.toLowerCase().includes("xplorer"))}
          loading={dappsLoading}
          onOpen={(dapp) => openDApp(dapp.url, { saveHistory: true, title: dapp.name })}
          colors={colors}
        />

      </ScrollView>
    </View>
  );
}
