#!/usr/bin/env bash
set -euo pipefail

echo "> Running script to generate forged withdrawal info into json file"
tsx scripts/seal/forgedWithdrawal/GenerateForgedWithdrawal.ts


