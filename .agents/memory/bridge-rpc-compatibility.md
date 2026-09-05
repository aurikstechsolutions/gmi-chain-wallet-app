---
name: Bridge RPC compatibility
description: Network-specific constraints for deploying and polling the BSC↔GMI bridge
---

GMI’s RPC does not accept bytecode containing newer opcodes such as PUSH0, so bridge contracts must target an older compatible EVM version such as Paris. Public BSC RPC endpoints may reject large eth_getLogs ranges, so relayer polling should use conservative block chunks.

**Why:** A standard recent Solidity build failed gas estimation on GMI before a transaction was sent, and the public BSC endpoint rejected a 2,000-block log query.

**How to apply:** Set the Solidity compiler EVM target to Paris (or another GMI-supported target) for bridge deployments, and keep BSC event polling chunks at 500 blocks or lower unless the configured RPC provider documents a higher limit.