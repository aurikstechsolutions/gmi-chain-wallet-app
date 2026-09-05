---
name: DApp browser RPC proxy architecture
description: Why all RPC calls in the GMI wallet DApp browser go through React Native instead of directly from the WebView.
---

# DApp browser RPC proxy — architectural decision

## The rule
ALL `window.ethereum.request()` calls (except `eth_chainId`, `net_version`, `eth_accounts`) are bridged via `postMessage` to React Native, which fetches from GMI's RPC and returns the result.

**Why:** WebView fetch was unreliable (CORS timing, iOS network stack, SSL context). When a WebView-side `fetch()` fails with a network TypeError, viem catches it and cannot classify it → "Could not coalesce error". React Native's `fetch` is battle-tested and consistently reaches the chain.

**How to apply:** `handleMessage` `default` case in `dapp.tsx` does the actual fetch and normalises the response before calling `resolveRequest`/`rejectRequest`.

## GMI-specific normalisations in the default handler
- `eth_getBlockByNumber` / `eth_getBlockByHash`: `miner` may be Bech32 (`gmi1qqq…`). Swap to `0x000…000`.
- `eth_estimateGas`: Always returns 21 000 regardless of calldata. For contract calls (`data` non-empty and estimate ≤ 21000), override to `0x927C0` (600 000).

## Key files
- `artifacts/mchain-wallet/app/(tabs)/dapp.tsx` — `buildProviderScript()` (injected JS) + `handleMessage` with switch/default.
- `artifacts/mchain-wallet/services/crypto.ts` — `signEvmTransaction` (EIP-1559, gasPrice 1 Gwei, GMI chain ID).
