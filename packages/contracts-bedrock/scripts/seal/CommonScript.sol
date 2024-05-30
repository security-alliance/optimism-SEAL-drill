// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import 'forge-std/Script.sol';

import {Safe} from 'safe-contracts/Safe.sol';
import {Enum as SafeOps} from 'safe-contracts/common/Enum.sol';
import {ProxyAdmin} from 'src/universal/ProxyAdmin.sol';
import {OptimismPortal} from 'src/L1/OptimismPortal.sol';
import {L2StandardBridge} from 'src/L2/L2StandardBridge.sol';
import {L2OutputOracle} from 'src/L1/L2OutputOracle.sol';
import {L1CrossDomainMessenger} from 'src/L1/L1CrossDomainMessenger.sol';
import {SuperchainConfig} from 'src/L1/SuperchainConfig.sol';
import {StorageSetter} from 'src/universal/StorageSetter.sol';
import {L1ERC721Bridge} from 'src/L1/L1ERC721Bridge.sol';
import {L1StandardBridge} from 'src/L1/L1StandardBridge.sol';
import {CrossDomainMessenger} from 'src/universal/CrossDomainMessenger.sol';
import {OptimismMintableERC20Factory} from 'src/universal/OptimismMintableERC20Factory.sol';
import {SystemConfig} from 'src/L1/SystemConfig.sol';

contract CommonScript is Script {
  struct Deployment {
    string name;
    address payable addr;
  }

  mapping(string => Deployment) internal _namedDeployments;
  error InvalidDeployment(string);
  string internal contractsDir;

  // Prod settings
  address prodSuperchainConfigAddress;
  address prodChallenger;
  address prodProxyAdminOwner;

  uint256 l2OutputStart;
  address l1Proposer;
  ProxyAdmin proxyAdmin;

  OptimismPortal optimismPortal;
  L2OutputOracle l2OutputOracle;
  L1CrossDomainMessenger l1CrossDomainMessenger;
  Safe safe;
  SuperchainConfig superchainConfig;
  L1ERC721Bridge l1Erc721Bridge;
  CrossDomainMessenger crossDomainMessenger;
  L1StandardBridge l1StandardBridge;
  OptimismMintableERC20Factory optimismMintableERC20Factory;
  SystemConfig systemConfig;

  address optimismPortalImplementation;
  address l2OutputOracleImplementation;
  address l1CrossDomainMessengerImplementation;
  address superchainConfigImplementation;
  address l1Erc721BridgeImplementation;
  address l1StandardBridgeImplementation;
  address optimismMintableERC20FactoryImplementation;
  address systemConfigImplementation;
  address l1BatchSender;
  address batchInbox;
  address unsafeBlockSigner;
  StorageSetter storageSetter;


  function setUpScripts() public {
    string memory root = vm.projectRoot();
    contractsDir = string.concat(root, '/contracts/');

    string memory contractsPath = string.concat(contractsDir, 'contracts.json');
    console.log('Loading addresses from %s', contractsPath);
    _loadAddresses(contractsPath);

    proxyAdmin = ProxyAdmin(get('ProxyAdmin').addr);
    optimismPortal = OptimismPortal(get('OptimismPortal').addr);
    l2OutputOracle = L2OutputOracle(get('L2OutputOracle').addr);
    systemConfig = SystemConfig(get('SystemConfig').addr);
    safe = Safe(get('SystemOwnerSafe').addr);
    l1CrossDomainMessenger = L1CrossDomainMessenger(get('L1CrossDomainMessenger').addr);
    l1Erc721Bridge = L1ERC721Bridge(get('L1ERC721Bridge').addr);
    crossDomainMessenger = CrossDomainMessenger(get('L1CrossDomainMessenger').addr);
    l1StandardBridge = L1StandardBridge(get('L1StandardBridge').addr);
    optimismMintableERC20Factory = OptimismMintableERC20Factory(get('OptimismMintableERC20Factory').addr);
    superchainConfig = SuperchainConfig(get('SuperchainConfigProxy').addr);
    optimismPortalImplementation = get('OptimismPortal').addr;
    l2OutputOracleImplementation = get('L2OutputOracle').addr;
    l1CrossDomainMessengerImplementation = get('L1CrossDomainMessenger').addr;
    superchainConfigImplementation = get('SuperchainConfig').addr;
    l1Erc721BridgeImplementation = get('L1ERC721Bridge').addr;
    l1StandardBridgeImplementation = get('L1StandardBridge').addr;
    optimismMintableERC20FactoryImplementation = get(
      'OptimismMintableERC20Factory'
    ).addr;
    systemConfigImplementation = get('SystemConfig').addr;
    l1BatchSender = get('L1BatchSender').addr;
    batchInbox = get('L2BatchInbox').addr;
    unsafeBlockSigner = get('UnsafeBlockSigner').addr;
    storageSetter = StorageSetter(get('StorageSetter').addr);
    l1Proposer = get('L1Proposer').addr;
    l2OutputStart = vm.envUint('L2_OUTPUT_ORACLE_START');


    // Prod configs
    prodSuperchainConfigAddress = get('SEPOLIA_SuperchainConfig').addr;
    prodChallenger = get('SEPOLIA_Challenger').addr;
    prodProxyAdminOwner = get('SEPOLIA_ProxyAdminOwner').addr;
  }

  /// @notice Populates the addresses to be used in a script based on a JSON file.
  ///         The format of the JSON file is the same that it output by this script
  ///         as well as the JSON files that contain addresses in the `superchain-ops`
  ///         repo. The JSON key is the name of the contract and the value is an address.
  function _loadAddresses(string memory _path) internal {
    string[] memory commands = new string[](3);
    commands[0] = 'bash';
    commands[1] = '-c';
    commands[2] = string.concat('jq -cr < ', _path);
    string memory json = string(vm.ffi(commands));
    string[] memory keys = vm.parseJsonKeys(json, '');
    for (uint256 i; i < keys.length; i++) {
      string memory key = keys[i];
      address addr = stdJson.readAddress(json, string.concat('$.', key));
      save(key, addr);
    }
  }

  /// @notice Saves addresses to deployments
  /// @param _name The name of the deployment.
  /// @param _deployed The address of the deployment.
  function save(string memory _name, address _deployed) public {
    if (bytes(_name).length == 0) {
      revert InvalidDeployment('EmptyName');
    }
    if (bytes(_namedDeployments[_name].name).length > 0) {
      revert InvalidDeployment('AlreadyExists');
    }

    Deployment memory deployment = Deployment({
      name: _name,
      addr: payable(_deployed)
    });
    _namedDeployments[_name] = deployment;
  }

  /// @notice Returns a deployment that is suitable to be used to interact with contracts.
  /// @param _name The name of the deployment.
  /// @return The deployment.
  function get(string memory _name) public view returns (Deployment memory) {
    Deployment memory deployment = _namedDeployments[_name];
    if (deployment.addr != address(0)) {
      return deployment;
    } else {
      revert InvalidDeployment('NotFound');
    }
  }

  function upgrade(
    address payable _proxy,
    address implementation_addr
  ) internal {
    proxyAdmin.upgrade(_proxy, implementation_addr);
  }

  /// @notice Call from the Safe contract to the Proxy Admin's upgrade method
  function _upgradeViaSafe(address _proxy, address _implementation) internal {
    bytes memory data = abi.encodeCall(
      ProxyAdmin.upgrade,
      (payable(_proxy), _implementation)
    );

    _callViaSafe({_target: address(proxyAdmin), _data: data});
  }

  /// @notice Call from the Safe contract to the Proxy Admin's upgrade and call method
  function _upgradeAndCallViaSafe(
    address _proxy,
    address _implementation,
    bytes memory _innerCallData
  ) internal {
    bytes memory data = abi.encodeCall(
      ProxyAdmin.upgradeAndCall,
      (payable(_proxy), _implementation, _innerCallData)
    );

    _callViaSafe({_target: address(proxyAdmin), _data: data});
  }

  /// @notice Make a call from the Safe contract to an arbitrary address with arbitrary data
  function _callViaSafe(address _target, bytes memory _data) internal {
    // This is the signature format used the caller is also the signer.
    bytes memory signature = abi.encodePacked(
      uint256(uint160(msg.sender)),
      bytes32(0),
      uint8(1)
    );

    safe.execTransaction({
      to: _target,
      value: 0,
      data: _data,
      operation: SafeOps.Operation.Call,
      safeTxGas: 0,
      baseGas: 0,
      gasPrice: 0,
      gasToken: address(0),
      refundReceiver: payable(address(0)),
      signatures: signature
    });
  }
}
