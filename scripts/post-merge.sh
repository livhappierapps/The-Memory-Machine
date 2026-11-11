#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Match the api-server-unit-tests validation gate before schema setup/restarts.
pnpm --filter @workspace/api-server run test
pnpm --filter db push
