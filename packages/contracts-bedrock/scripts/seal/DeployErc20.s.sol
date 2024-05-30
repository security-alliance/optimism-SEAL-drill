// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';

import {Proxy} from 'src/universal/Proxy.sol';
import {ProxyAdmin} from 'src/universal/ProxyAdmin.sol';
import {ERC20UpgradeableMintable} from 'src/seal/ERC20UpgradeableMintable.sol';
import {CommonScript} from './CommonScript.sol';


contract Deploy is CommonScript {

  function setUp() public {
    setUpScripts();
  }

  function run() public {

    vm.startBroadcast();

    ERC20UpgradeableMintable logic_v1 = new ERC20UpgradeableMintable();

    Proxy proxy = new Proxy(address(proxyAdmin));

    proxyAdmin.upgradeAndCall(
      payable(address(proxy)),
      address(logic_v1),
      abi.encodeWithSignature(
        'init(string,string,address)',
        'SEAL Token',
        'SEAL',
        msg.sender
      )
    );

    vm.stopBroadcast();
  }

}
