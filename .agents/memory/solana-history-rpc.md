---
name: Solana history RPC
description: Compatibility rule for reading parsed Solana transaction history from the configured public RPC.
---

Use `getTransaction` with `encoding: "jsonParsed"` for parsed transaction history. Do not assume `getParsedTransaction` or a batch `getParsedTransactions` method is available on the public endpoint.

**Why:** The configured endpoint returned JSON-RPC `Method not found` for both parsed-specific method names while returning the expected parsed instruction structure from `getTransaction`.

**How to apply:** Fetch signatures with `getSignaturesForAddress`, then request `getTransaction` in small concurrent batches and filter the returned system/SPL instructions locally.