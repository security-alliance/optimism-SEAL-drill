// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';

import {Proxy} from 'src/universal/Proxy.sol';
import {OptimismPortal} from 'src/L1/OptimismPortal.sol';
import {SuperchainConfig} from 'src/L1/SuperchainConfig.sol';
import {L2OutputOracle} from 'src/L1/L2OutputOracle.sol';
import {L1CrossDomainMessenger} from 'src/L1/L1CrossDomainMessenger.sol';
import {StorageSetter} from 'src/universal/StorageSetter.sol';
import {CommonScript} from './CommonScript.sol';
import {L1ERC721Bridge} from 'src/L1/L1ERC721Bridge.sol';
import {L1StandardBridge} from 'src/L1/L1StandardBridge.sol';
import {SystemConfig} from 'src/L1/SystemConfig.sol';
import { Constants } from "src/libraries/Constants.sol";

contract Deploy is CommonScript {
  SuperchainConfig prodSuperchainConfig;
  function setUp() public {
    setUpScripts();
    prodSuperchainConfig = SuperchainConfig(prodSuperchainConfigAddress);
  }

  function run() public {
    vm.startBroadcast();

    _configurePortal();
    _configureL1Erc721Bridge();
    _configureL2OutputOracle();
    _configureL1StandardBridge();
    _configureL1CrossDomainMessenger();
    _configureSystemConfig();

    vm.stopBroadcast();
  }
  function _configurePortal() internal {
    _upgradeAndCallViaSafe(
      address(optimismPortal),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );

    _upgradeAndCallViaSafe(
      address(optimismPortal),
      address(optimismPortalImplementation),
      abi.encodeCall(
        OptimismPortal.initialize,
        (
          L2OutputOracle(address(l2OutputOracle)),
          systemConfig,
          prodSuperchainConfig
        )
      )
    );
  }

  function _configureSystemConfig() internal {

    _upgradeAndCallViaSafe(
      address(systemConfig),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );

        bytes32 batcherHash = bytes32(uint256(uint160(l1BatchSender)));

    _upgradeAndCallViaSafe(
      address(systemConfig),
      systemConfigImplementation,
      abi.encodeCall(
        SystemConfig.initialize,
        (
          address(safe), // System config owner
          188, // gas price oracle overhead
          684000, // gas price oracle scalar
          batcherHash,
          uint64(30000000), // genesis gas limit
          unsafeBlockSigner,
          Constants.DEFAULT_RESOURCE_CONFIG(),
          batchInbox,
          SystemConfig.Addresses({
            l1CrossDomainMessenger: address(l1CrossDomainMessenger),
            l1ERC721Bridge: address(l1Erc721Bridge),
            l1StandardBridge: address(l1StandardBridge),
            l2OutputOracle: address(l2OutputOracle),
            optimismPortal: address(optimismPortal),
            optimismMintableERC20Factory: address(optimismMintableERC20Factory)
          })
        )
        )
    );

  }

  function _configureL1Erc721Bridge() internal {
    _upgradeAndCallViaSafe(
      address(l1Erc721Bridge),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );

    _upgradeAndCallViaSafe(
      address(l1Erc721Bridge),
      l1Erc721BridgeImplementation,
      abi.encodeCall(
        L1ERC721Bridge.initialize,
        (crossDomainMessenger, prodSuperchainConfig)
      )
    );
  }

  function _configureL2OutputOracle() internal {
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
          l1Proposer,
          prodChallenger,
          // 1800 // Finalization period seconds 30 min for testing
          604800 // Finalization period seconds 7 days
        )
      )
    );
  }
  function _configureL1StandardBridge() internal {
    _upgradeAndCallViaSafe(
      address(l1StandardBridge),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );
    _upgradeAndCallViaSafe(
      address(l1StandardBridge),
      l1StandardBridgeImplementation,
      abi.encodeCall(
        L1StandardBridge.initialize,
        (crossDomainMessenger, prodSuperchainConfig)
      )
    );
  }

  function _configureL1CrossDomainMessenger() internal {
    _upgradeAndCallViaSafe(
      address(l1CrossDomainMessenger),
      address(storageSetter),
      abi.encodeWithSignature(
        'setBytes32(bytes32,bytes32)',
        bytes32(0x0),
        bytes32(0x0)
      )
    );

    _upgradeAndCallViaSafe(
      address(l1CrossDomainMessenger),
      address(l1CrossDomainMessengerImplementation),
      abi.encodeCall(
        L1CrossDomainMessenger.initialize,
        (prodSuperchainConfig, OptimismPortal(payable(address(optimismPortal))))
      )
    );
  }
}
