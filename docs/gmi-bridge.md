# GMI bridge operations

The bridge uses a trusted relayer between a canonical ERC-20 on BSC and its
wrapped representation on GMI:

1. BSC users approve and deposit into `GmiBridgeLockbox`.
2. The API waits for the configured confirmation count and calls `mint` on
   `GmiBridgeMinter`.
3. GMI users call `withdraw`, which burns the wrapped asset and emits a
   destination address.
4. The API calls `release` on the BSC lockbox using the event ID as the
   replay-protected withdrawal ID.

The relayer is deliberately not a user wallet. Use a dedicated operator
account, grant it only `RELAYER_ROLE`, and keep its private key in Replit
Secrets or the production secret manager. Never put it in `config.json`,
source control, or client environment variables.

## API configuration

Set these environment variables before enabling live relay:

| Variable | Purpose |
| --- | --- |
| `GMI_BRIDGE_BSC_RPC_URL` | BSC JSON-RPC endpoint |
| `GMI_BRIDGE_GMI_RPC_URL` | Optional GMI JSON-RPC override; defaults to the GMI node |
| `GMI_BRIDGE_BSC_LOCKBOX_ADDRESS` | Deployed BSC `GmiBridgeLockbox` |
| `GMI_BRIDGE_BSC_TOKEN_ADDRESS` | Canonical BSC token |
| `GMI_BRIDGE_GMI_MINTER_ADDRESS` | Deployed GMI `GmiBridgeMinter` |
| `GMI_BRIDGE_GMI_TOKEN_ADDRESS` | Deployed GMI `GmiWrappedAsset` |
| `GMI_BRIDGE_BSC_TOKEN_DECIMALS` | Exact canonical token decimals |
| `GMI_BRIDGE_GMI_TOKEN_DECIMALS` | Exact wrapped token decimals |
| `GMI_BRIDGE_RELAYER_PRIVATE_KEY` | Relayer secret; configure through workspace secrets |
| `GMI_BRIDGE_OPERATOR_KEY` | Secret required by the recovery endpoint |
| `GMI_BRIDGE_FEE_BPS` | Bridge fee in basis points; defaults to `0` |
| `GMI_BRIDGE_MIN_AMOUNT` | Minimum displayed token amount; defaults to `0` |
| `GMI_BRIDGE_CONFIRMATIONS` | Required confirmations on each chain; defaults to `12` |

The API reports `enabled: false` and the missing configuration names until
all required values are valid. Contract and token addresses are never
hard-coded in the application.

## Routes

- `GET /api/bridge/config` — public route metadata and readiness.
- `POST /api/bridge/quote` — exact decimal quote with fee and net amount.
- `POST /api/bridge/check` — source token/native balance and destination
  lockbox liquidity.
- `POST /api/bridge/notify` — queues a confirmed source transaction for relay.
- `GET /api/bridge/status/:txHash?sourceChain=bsc|gmi` — lifecycle status.
- `POST /api/bridge/recover` — operator-only retry for a failed transfer.

Transfer state and relay cursors are stored in Redis. The destination contracts
also enforce replay protection, so a duplicate notification cannot mint or
release the same event twice.

## Funded E2E verification

The API package includes a real-chain test runner at
`artifacts/api-server/scripts/bridge-e2e.mjs`. It is deliberately opt-in because
it signs transactions and spends the test wallet's tokens and gas. It exits
without doing anything unless `GMI_BRIDGE_E2E=1`.

Use a disposable funded wallet and configure the bridge variables plus the
wallet's private key through Replit Secrets (never paste the key into chat,
source control, or the wallet app):

```sh
GMI_BRIDGE_E2E=1 \
GMI_BRIDGE_E2E_PRIVATE_KEY=... \
GMI_BRIDGE_E2E_AMOUNT=0.1 \
pnpm --filter @workspace/api-server run test:bridge:e2e
```

The runner fails closed unless `/api/bridge/config` reports `enabled: true`.
It checks native gas on both chains, approves and deposits the canonical token
on BSC, waits for the configured source confirmations, verifies the wrapped
balance delta on GMI, withdraws that exact minted amount, verifies the
canonical balance delta on BSC, and then sends duplicate notifications in both
directions. Duplicate calls must return the original confirmed relay hash and
must not change the destination balance.

To verify the operator recovery path against a known failed transfer, provide
the failed source transaction and operator key as secrets:

```sh
GMI_BRIDGE_E2E=1 \
GMI_BRIDGE_E2E_PRIVATE_KEY=... \
GMI_BRIDGE_E2E_RECOVERY_SOURCE_CHAIN=bsc \
GMI_BRIDGE_E2E_RECOVERY_TX_HASH=0x... \
GMI_BRIDGE_E2E_OPERATOR_KEY=... \
pnpm --filter @workspace/api-server run test:bridge:e2e
```

The recovery assertion accepts either a new relay (the destination balance
increases by exactly the recorded net amount) or a previously successful relay
whose state write failed (the balance does not increase again). A second
recovery call must return the same confirmed relay hash.

## Final deployment checklist

- Verify both bridge contracts and both tokens on their explorers.
- Grant `MINTER_ROLE` and `BURNER_ROLE` only to `GmiBridgeMinter`.
- Set each bridge's `remoteBridge` to its counterpart.
- Confirm the relayer, pauser, administrator, and liquidity-manager addresses.
- Fund the BSC lockbox with canonical liquidity and fund the relayer with BNB
  and GMI gas.
- Set the API variables using the deployed addresses and exact decimals.
- Run the funded deposit → mint and withdraw → release test above.
- Run the recovery assertion with a deliberately failed relay attempt.
