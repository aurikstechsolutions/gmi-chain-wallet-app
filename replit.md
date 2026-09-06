# MChain Validator Wallet

A React Native (Expo) mobile wallet and validator app for the MChain network — handles secp256k1 key generation, MC token send/receive, validator registration/heartbeats, and transaction history.

## Run & Operate

- `pnpm --filter @workspace/mchain-wallet run dev` — start the Expo dev server (port 19144)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- Replit preview: use the `Project` workflow to start the API Server and Admin Panel together; the admin panel is the web preview on port 5000.
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54, expo-router (file-based), React Native
- State: React Context (WalletContext), @tanstack/react-query
- Crypto: @noble/curves (secp256k1), @noble/hashes (keccak256), bech32
- Storage: expo-secure-store (private key), AsyncStorage (metadata)
- Background: expo-background-fetch + expo-task-manager (heartbeats)

## Where things live

- `artifacts/mchain-wallet/` — Expo mobile app
  - `app/_layout.tsx` — root layout (WalletProvider, QueryClient, nav)
  - `app/(tabs)/` — 5 tab screens: index, send, receive, validator, settings
  - `app/onboarding.tsx` — first-run keypair generation flow
  - `context/WalletContext.tsx` — global wallet state, key management
  - `services/crypto.ts` — secp256k1 keygen + mxc1 bech32 address derivation
  - `services/api.ts` — all MChain REST API calls (node.mymchain.com)
  - `services/backgroundTasks.ts` — expo-task-manager heartbeat task
  - `hooks/useHeartbeat.ts` — foreground heartbeat polling (60s)
  - `constants/colors.ts` — dark-only theme palette
- `artifacts/api-server/` — Express API server

## Architecture decisions

- Dark-only theme: both `light` and `dark` color keys use the same dark palette (`#0A0F1E` background, `#0EA5E9` primary)
- Address derivation: compressed secp256k1 pubkey → keccak256 → last 20 bytes → bech32 prefix "mxc1"
- Private key stored only in expo-secure-store; never in AsyncStorage or logs
- Background heartbeat uses `expo-background-fetch` + `expo-task-manager`; foreground polling via React hook
- Chain ID: 1888, native token: MC, API base: `https://node.mymchain.com/api`

## Product

MChain Validator Wallet lets users: generate a secp256k1 wallet with a `mxc1` bech32 address, register as a validator on the MChain network (Chain ID 1888), send/receive MC tokens via QR code, monitor validator heartbeat status with background uptime tracking, and view transaction history.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The chain API (`chain.mvault.pro`) sends duplicate `Access-Control-Allow-Origin` headers — CORS errors appear in the web preview but native iOS/Android builds are unaffected
- Use `@noble/curves@^1.x` and `@noble/hashes@^1.x` — v2 has Metro bundler subpath export issues in Expo
- `expo-battery` requires `Platform.OS !== 'web'` guard
- Background task (`HEARTBEAT_TASK`) must be defined via `TaskManager.defineTask` at module top level — the import in `_layout.tsx` ensures this runs before registration

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `expo` skill for Expo-specific patterns
