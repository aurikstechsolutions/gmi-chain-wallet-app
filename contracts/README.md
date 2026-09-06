# GMI Bridge contracts

These contracts implement the trusted-relayer BSC ↔ GMI design used by the
wallet and API. They intentionally do not contain hard-coded token, bridge,
RPC, relayer, or operator addresses.

## Deployment order

1. Deploy `GmiWrappedAsset` on GMI with the desired name, symbol, and token
   decimals. Use the bridge administrator as `admin_`.
2. Deploy `GmiBridgeLockbox` on the canonical-token chain with:
   `canonicalToken`, the source chain ID, GMI chain ID, administrator,
   relayer, pauser, and liquidity manager.
3. Deploy `GmiBridgeMinter` on GMI with the wrapped token address, GMI chain
   ID, the canonical chain ID, administrator, relayer, and pauser.
4. Grant `MINTER_ROLE` and `BURNER_ROLE` on `GmiWrappedAsset` to the
   `GmiBridgeMinter` address.
5. Set each bridge's `remoteBridge` to the other bridge's EVM address.
6. Fund the lockbox with canonical liquidity for GMI → canonical releases.
   Fund the relayer account with native gas on both chains.

The API must be configured with the deployed addresses and exact token
decimals before the bridge is enabled. A relayer role is a trusted operator:
it can mint wrapped tokens and release lockbox liquidity. Use a dedicated
wallet, keep it in the deployment secret manager, rotate it through role
grants, and pause both contracts during an incident.

## Address encoding

Bridge event destinations are `bytes32` values containing a 20-byte EVM
address left-padded with zeroes. The wallet may display a `gmi1...` address,
but it converts it to the underlying EVM address before signing. BSC
recipients must be `0x...` addresses.

## Verification checklist

- Confirm both configured chain IDs and token decimals.
- Verify the wrapped token has no mint/burn role other than the GMI bridge.
- Verify the lockbox and minter point at each other.
- Verify the relayer and pauser addresses before funding liquidity.
- Test deposit → mint and withdraw → release with small amounts.
- Confirm duplicate relay attempts are rejected by the destination contract.