// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';

import {Predeploys} from 'src/libraries/Predeploys.sol';
// Target contract dependencies
import {OptimismMintableERC20} from 'src/universal/OptimismMintableERC20.sol';

// Target contract
import {OptimismMintableERC20Factory} from 'src/universal/OptimismMintableERC20Factory.sol';

contract Deploy is Script {
  OptimismMintableERC20Factory l2OptimismMintableERC20Factory;

  address l1Token = 0x608DDcDF387c1638993Dc0F45Dfd2746b08B9b4a;

  function setUp() public {
    l2OptimismMintableERC20Factory = OptimismMintableERC20Factory(
      Predeploys.OPTIMISM_MINTABLE_ERC20_FACTORY
    );
  }

  function run() public {
    vm.startBroadcast();

    l2OptimismMintableERC20Factory.createStandardL2Token(
      l1Token,
      'Seal Token L2',
      'SEAL'
    );

    vm.stopBroadcast();
  }
}
