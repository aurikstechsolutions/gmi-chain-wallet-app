#!/bin/bash
set -e

# Install all workspace packages (root + each workspace package individually
# to ensure pnpm's strict isolation links local node_modules correctly)
pnpm install --frozen-lockfile

# Install each workspace package individually so local node_modules are linked
pnpm --filter @workspace/db install
pnpm --filter @workspace/api-zod install
pnpm --filter @workspace/api-spec install
pnpm --filter @workspace/api-client-react install
pnpm --filter @workspace/api-server install
pnpm --filter @workspace/admin-panel install

# Push database schema
pnpm --filter @workspace/db run push
