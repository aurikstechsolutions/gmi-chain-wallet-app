---
name: BSC transfer quotes
description: Safety rule for BNB Smart Chain native and token transaction confirmation.
---

Before showing BNB Smart Chain confirmation, assert chain ID 56 and quote the pending nonce, live gas price, and gas estimate for the exact transaction. Sign only those reviewed parameters.

**Why:** Fixed gas limits fail for payable contract recipients, while estimating after PIN can charge a fee different from what the user reviewed.

**How to apply:** Buffer the gas estimate, show the resulting maximum BNB fee and nonce, expire old quotes, and recheck the network, nonce, and exact balances before signing and broadcasting.