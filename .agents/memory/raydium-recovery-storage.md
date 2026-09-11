---
name: Raydium recovery storage
description: Storage boundary for interrupted Raydium swap batches
---

Resumable Raydium transaction batches belong in durable general-purpose app storage, while private keys remain in SecureStore. A batch may contain multiple base64 transactions and exceed platform keychain value limits.

**Why:** SecureStore is appropriate for small secrets, but it is not a reliable container for an arbitrarily sized serialized transaction batch.

**How to apply:** Scope recovery records by wallet identity, serialize bigint quote fields as decimal strings, and only clear the record after confirmed completion or an explicit user dismissal.