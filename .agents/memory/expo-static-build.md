---
name: Expo static build ports
description: How the wallet's static Expo export coexists with the managed mockup preview.
---

The static Expo export must be able to use a Metro port other than 8081 when the managed mockup preview is running.

**Why:** The mockup preview commonly owns 8081; a non-interactive Expo build cannot answer Metro's “use another port?” prompt and fails before export.

**How to apply:** Keep the build's default at 8081 for standalone use, but pass an alternate `METRO_PORT` for concurrent exports and route health checks, bundles, manifests, and asset URLs through that same port.