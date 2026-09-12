---
name: Raydium stale retries
description: Recovery behavior for Raydium transactions that fail before any transaction is confirmed.
---

When a Raydium swap has zero confirmed transactions, do not resend the saved serialized batch. Discard it and build a fresh quote/transaction before retrying.

**Why:** The saved transaction contains a recent blockhash and simulation context. Reusing it after a failed preflight can create an endless “Resume swap” failure loop.

**How to apply:** Preserve recovery batches only for partially confirmed multi-transaction swaps. For zero-confirmation failures, keep the amount and direction but clear the raw transaction progress and return to the live quote flow.