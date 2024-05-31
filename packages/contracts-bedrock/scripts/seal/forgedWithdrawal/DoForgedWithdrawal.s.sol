// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';
import {stdJson} from 'forge-std/StdJson.sol';

import {Proxy} from 'src/universal/Proxy.sol';
import {OptimismPortal} from 'src/L1/OptimismPortal.sol';
import {L2OutputOracle} from 'src/L1/L2OutputOracle.sol';
import {SuperchainConfig} from 'src/L1/SuperchainConfig.sol';
import {StorageSetter} from 'src/universal/StorageSetter.sol';
import {SystemConfig} from 'src/L1/SystemConfig.sol';
import {CommonScript} from '../CommonScript.sol';
import {Types} from 'src/libraries/Types.sol';

contract DoForgedWithdrawal is CommonScript {
  function setUp() public {
    setUpScripts();
  }

  function run() public {

    string memory storedWithdrawalsPath = string.concat(vm.projectRoot(), '/scripts/seal/forgedWithdrawal/');
    string memory storedWithdrawalFileName = 'forgedWithdrawal.json';
    string memory jsonPath = string.concat(storedWithdrawalsPath, storedWithdrawalFileName);

    console.log('Loading forged withdrawal from %s', jsonPath);

    string[] memory commands = new string[](3);
    commands[0] = 'bash';
    commands[1] = '-c';
    commands[2] = string.concat('jq -cr < ', jsonPath);
    string memory json = string(vm.ffi(commands));

    bytes[] memory _withdrawalProof = stdJson.readBytesArray(json, '$.proof');

    Types.WithdrawalTransaction memory _tx = Types.WithdrawalTransaction({
      nonce: stdJson.readUint(json, '$.nonce'),
      sender: stdJson.readAddress(json, '$.sender'),
      target: stdJson.readAddress(json, '$.target'),
      value: stdJson.readUint(json, '$.value'),
      gasLimit: stdJson.readUint(json, '$.gasLimit'),
      data: stdJson.readBytes(json, '$.data')
    });

    uint256 _l2OutputIndex = stdJson.readUint(json, '$.l2OutputIndex');

    Types.OutputRootProof memory _outputRootProof = Types.OutputRootProof({
      version: stdJson.readBytes32(json, '$.version'),
      stateRoot: stdJson.readBytes32(json, '$.stateRoot'),
      messagePasserStorageRoot: stdJson.readBytes32(json, '$.storageHash'),
      latestBlockhash: stdJson.readBytes32(json, '$.latestBlockhash')
    });


    vm.startBroadcast();

    optimismPortal.proveWithdrawalTransaction({
      _tx: _tx,
      _l2OutputIndex: _l2OutputIndex,
      _outputRootProof: _outputRootProof,
      _withdrawalProof: _withdrawalProof
    });

    vm.stopBroadcast();

  }
}
