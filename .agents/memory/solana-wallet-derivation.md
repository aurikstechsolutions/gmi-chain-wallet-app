---
name: Solana wallet derivation
description: The wallet’s cross-chain key policy and the special handling required for NFC-backed entries.
---

Derive the Solana Ed25519 keypair deterministically from the same securely stored 32-byte secret used by the wallet’s existing account. Do not store a second Solana private key.

**Why:** A receive-only Solana address is unsafe because users could accept funds without retaining signing capability. Reusing the existing secret preserves spend access and avoids another secret-backup surface.

**How to apply:** Normal wallets can derive and migrate their Solana public address whenever their SecureStore secret is available. NFC-backed wallets must derive while the temporary keypair is present and persist only the public Solana address; signing still requires the NFC key flow.