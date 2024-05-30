#!/usr/bin/env bash
set -euo pipefail

echo "> Running forge script to read from json file and prove tx onchain"

echo ""
read -p "Please enter the network prefix to confirm you are intending the correct network: " user_input
if [ "$user_input" != "${NETWORK_PREFIX}" ]; then
  echo "Error: Incorrect network prefix. The input does not match the NETWORK_PREFIX."
  exit 1
fi


flags=""
if [ -n "${DO_EXPLOIT_BROADCAST:-}" ]; then
  echo ""
  read -p "Type 'confirm' to proceed with broadcasting: " confirmation
  if [ "$confirmation" = "confirm" ]; then
    flags="--broadcast --private-key $EXPLOIT_PRIVATE_KEY"
  else
    echo "Error: Broadcasting not confirmed. The input was not 'confirm'."
    exit 1
  fi
fi

forge script -vvv scripts/seal/forgedWithdrawal/NewForgedWithdrawal.s.sol --rpc-url "$DEPLOY_ETH_RPC_URL" $flags