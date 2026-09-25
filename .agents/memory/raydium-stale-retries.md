---
name: Raydium stale retries
description: Recovery behavior for Raydium transactions that fail before any transaction is confirmed.
---

When a Raydium swap has zero confirmed transactions, do not resend the saved serialized batch. Discard it and build a fresh quote/transaction before retrying. Broadcast and confirmation requests should try the configured Solana RPC endpoints rather than assuming the primary accepts writes.

**Why:** The saved transaction contains a recent blockhash and simulation context. Reusing it after a failed preflight can create an endless “Resume swap” failure loop. The primary public RPC can also reject broadcasts with HTTP 403 while a fallback accepts them.

**How to apply:** Preserve recovery batches only for partially confirmed swaps or pending transactions with a known signature. For zero-confirmation failures with no signature, keep amount/direction but clear raw transaction progress and return to the live quote flow. If a signature exists, resume by checking confirmation without rebroadcasting.