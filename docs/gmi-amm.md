# GMI AMM operations

The GMI AMM is a non-upgradeable, Uniswap V2-style constant-product exchange
for curated standard ERC-20 pairs. The first configured pair is `wUSDT` /
wrapped native GMI (`wGMI`). The router supports exact-input swaps, native GMI
wrapping and unwrapping, and add/remove liquidity.

The AMM does not preset or guarantee a stablecoin price. A token contract
address identifies the asset; it does not establish that one `wUSDT` equals
one US dollar. The displayed rate is derived from the current pool reserves.
The seeded test pool therefore has a deliberately test-only exchange ratio.
Establishing a dollar peg requires an explicit redemption/backing system,
oracle policy, and ongoing liquidity management outside this AMM.

## Security model

- Pair creation is controlled by the factory owner; the wallet only exposes
  pairs returned by the public AMM configuration.
- The pair has no flash-swap callback surface in this release.
- Router operations require caller-provided minimum amounts and deadlines.
- Pair swaps use checked reserve/invariant math and a fixed fee set at factory
  deployment.
- Token transfers use OpenZeppelin `SafeERC20`; pairs use a lock against
  reentrancy.
- The contracts are non-upgradeable. Move factory ownership to a multisig
  before adding meaningful public liquidity.
- Only standard ERC-20 tokens are supported. Fee-on-transfer, rebasing, and
  reflection tokens must not be listed.

No smart contract can be guaranteed risk-free. Run the automated tests and
complete an independent human review before treating the deployment as
production-ready.

## Deployment

The deployment script compiles with the Paris EVM target and optimizer IR
because GMI rejects newer `PUSH0` bytecode:

```sh
GMI_AMM_DEPLOY=1 \
pnpm --filter @workspace/api-server exec node scripts/deploy-amm.mjs
```

The deployer key is read only from `GMI_BRIDGE_DEPLOYER_PRIVATE_KEY`. The
script refuses to run without the explicit `GMI_AMM_DEPLOY=1` gate. Do not put
the key in source control or client variables.

To seed a controlled initial pool, supply both amounts explicitly:

```sh
GMI_AMM_DEPLOY=1 \
GMI_AMM_INITIAL_WUSDT=1 \
GMI_AMM_INITIAL_GMI=0.0001 \
pnpm --filter @workspace/api-server exec node scripts/deploy-amm.mjs
```

Do not seed liquidity until the deployed addresses, token balances, price
assumption, and recipient have been reviewed. Adding liquidity is reversible
through the router, but the exchange rate is determined by the two supplied
amounts.

For an already deployed AMM, use the separate gated seeding script so it does
not redeploy contracts:

```sh
GMI_AMM_SEED=1 \
GMI_AMM_SEED_WUSDT=1 \
GMI_AMM_SEED_GMI=0.0001 \
pnpm --filter @workspace/api-server exec node scripts/seed-amm.mjs
```

## API configuration

Set the public values after deployment:

| Variable | Purpose |
| --- | --- |
| `GMI_AMM_FACTORY_ADDRESS` | Deployed factory |
| `GMI_AMM_ROUTER_ADDRESS` | Deployed router |
| `GMI_AMM_WRAPPED_NATIVE_ADDRESS` | Deployed wrapped GMI |
| `GMI_AMM_WUSDT_ADDRESS` | Configured `wUSDT` token |
| `GMI_AMM_WUSDT_WGMI_PAIR_ADDRESS` | Created pair |
| `GMI_AMM_FEE_BPS` | Fixed pair fee, normally `30` |

The wallet reads `GET /api/amm/config` and signs all mutations locally.