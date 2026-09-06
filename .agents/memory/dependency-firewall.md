---
name: Replit dependency firewall
description: Durable guidance for restoring imported pnpm workspaces when the Replit package mirror blocks transitive tarballs.
---

When a frozen pnpm install fails with a package-firewall 403 for a transitive dependency, keep the project’s pinned framework versions and use a narrow workspace override to a maintained compatible release. Regenerate the lockfile, then retry the frozen install.

**Why:** Imported Expo/React Native dependency trees can pin old transitive packages that the Replit package mirror rejects, while upgrading the framework parent would create compatibility risk.

**How to apply:** Identify the parent from the lockfile, verify the latest package’s engine/API compatibility, and add the smallest scoped override in `pnpm-workspace.yaml`. Do not bypass the firewall or replace the framework stack.

Artifact-generated workflows are managed by Replit and cannot be removed manually. If one duplicates a legacy workflow on the same port, stop the legacy owner and run the artifact-managed service as the single owner.

**Why:** Replit can add one workflow per imported artifact after setup, leaving older `.replit` workflows active and causing build races or port conflicts.

**How to apply:** Compare workflow names and ports before restarting. Keep one active owner per service port, then verify the artifact’s configured preview path through the Replit domain.