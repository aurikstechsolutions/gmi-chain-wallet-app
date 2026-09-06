---
name: GitHub publish pack repair
description: Recovery path when GitHub rejects a push with a missing expected object even though local Git passes fsck.
---

When GitHub rejects a complete push with `did not receive expected object` but the local repository passes `git fsck --full`, rebuild a fresh repository object database from the committed tree and push a no-delta snapshot.

**Why:** Repacking the existing repository and retrying can reproduce the same server-side unpack failure; a fresh object database removes problematic pack relationships while preserving the exact published file tree.

**How to apply:** Archive the intended commit into a temporary directory, initialize a clean repository, commit the snapshot, and upload it with delta generation disabled. Verify the remote tree hash against the clean source tree.