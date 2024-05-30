// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';

import {L2OutputOracle} from 'src/L1/L2OutputOracle.sol';
import {StorageSetter} from 'src/universal/StorageSetter.sol';
import {CommonScript} from './CommonScript.sol';

contract ProposeInvalidRoot is CommonScript {
  function setUp() public {
    setUpScripts();
  }

  function run() public {
    vm.startBroadcast();

    address tmpProposer = msg.sender;

    uint256 nextBlockNumber = l2OutputOracle.nextBlockNumber();
    bytes32 invalidRoot = keccak256(
      abi.encodePacked('invalidRoot', nextBlockNumber)
    );
    uint256 l1BlockNumber = block.number - 5;
    bytes32 l1BlockHash = blockhash(l1BlockNumber);

    _configureL2OutputOracle(tmpProposer);

    l2OutputOracle.proposeL2Output(
      invalidRoot,
      nextBlockNumber,
      l1BlockHash,
      l1BlockNumber
    );

    _configureL2OutputOracle(l1Proposer);

    vm.stopBroadcast();
  }

  function _configureL2OutputOracle(address proposer) internal {
    _upgradeAndCallViaSafe(
      address(l2OutputOracle),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );

    _upgradeAndCallViaSafe(
      address(l2OutputOracle),
      l2OutputOracleImplementation,
      abi.encodeCall(
        L2OutputOracle.initialize,
        (
          180, // submission interval
          2, // l2 block time
          0, // Starting block number
          l2OutputStart, // Starting timestamp
          proposer,
          prodChallenger,
          // 1800 // Finalization period seconds 30 min for testing
          604800 // Finalization period seconds 7 days
        )
      )
    );
  }
}
