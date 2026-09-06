// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title GMI Wrapped Asset
 * @notice The GMI-side representation of a canonical ERC-20 held in the
 *         GmiBridgeLockbox. Grant MINTER_ROLE and BURNER_ROLE only to the
 *         deployed GmiBridgeMinter contract.
 */
contract GmiWrappedAsset is ERC20, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin_,
        address pauser_
    ) ERC20(name_, symbol_) {
        if (admin_ == address(0)) revert("Invalid admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PAUSER_ROLE, pauser_ == address(0) ? admin_ : pauser_);
        _decimals = decimals_;
    }

    uint8 private immutable _decimals;

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mintByBridge(address recipient, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        _mint(recipient, amount);
    }

    function burnByBridge(address from, uint256 amount)
        external
        onlyRole(BURNER_ROLE)
        whenNotPaused
    {
        _burn(from, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256 amount)
        internal
        override
        whenNotPaused
    {
        super._update(from, to, amount);
    }
}