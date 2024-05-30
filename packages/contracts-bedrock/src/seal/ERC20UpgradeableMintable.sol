// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

// Demo contract that implements upgradeability
contract ERC20UpgradeableMintable is
    ERC20Upgradeable,
    OwnableUpgradeable
{
    constructor() {
        _disableInitializers();
    }

    function init(string memory name_, string memory symbol_, address owner_)
        external
        initializer
    {
        __ERC20_init(name_, symbol_);
        __Ownable_init();
        _transferOwnership(owner_);
    }

    // UNSAFE mint function for testing
    function mint(address _to, uint256 _amount) onlyOwner public {
        _mint(_to, _amount);
    }

}


contract ERC20UpgradeableMintable_V2 is
    ERC20Upgradeable,
    OwnableUpgradeable
{
    constructor() {
        _disableInitializers();
    }

    function init(string memory name_, string memory symbol_, address owner_)
        external
        reinitializer(2)
    {
        __ERC20_init(name_, symbol_);
        __Ownable_init();
        _transferOwnership(owner_);
    }

    // UNSAFE mint function for testing
    function mint(address _to, uint256 _amount) onlyOwner public {
        _mint(_to, _amount);
    }

}

