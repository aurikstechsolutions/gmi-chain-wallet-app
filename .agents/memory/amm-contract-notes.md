---
name: AMM contract notes
description: Durable implementation constraints for the GMI V2-style AMM contracts.
---

OpenZeppelin ERC20 v5 rejects minting to the zero address, so minimum-liquidity
locking must use a non-zero irrecoverable holder such as `address(1)`.

**Why:** The classic Uniswap V2 zero-address lock pattern is not compatible
with the ERC20 v5 receiver validation and causes an otherwise valid first LP
deposit to revert.

**How to apply:** Keep the locked LP amount permanently inaccessible and test
the first-liquidity path on the exact OpenZeppelin version used for deployment.