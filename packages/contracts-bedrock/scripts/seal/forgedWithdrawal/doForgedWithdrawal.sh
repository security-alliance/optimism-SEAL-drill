#!/usr/bin/env bash
set -euo pipefail

echo "> Running forge script to read from json file and prove tx onchain"

forge script -vvv DoForgedWithdrawal.s.sol --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOY_PRIVATE_KEY" --broadcast