---
name: Solana RPC fallback limits
description: Method-specific restrictions on the public Solana RPC endpoints used by the wallet.
---

Do not assume an RPC endpoint that supports `getBalance` also supports indexed token methods. PublicNode returned HTTP 403 with a personal-token requirement for `getTokenAccountsByOwner` and `getTokenAccountBalance`, while `getAccountInfo` worked without authentication.

**Why:** Native SOL balances could load through the fallback while SPL balance queries failed, making the dashboard show a dash despite a funded token account.

**How to apply:** Prefer the primary endpoint for owner/mint account enumeration. If indexed calls fail, read a known associated token account through `getAccountInfo` and decode the raw token amount; verify each provider/method combination independently.