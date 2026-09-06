// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Wrapped GMI
 * @notice ERC-20 representation of native GMI for AMM pairs.
 *
 * This contract is intentionally non-upgradeable and has no privileged mint
 * path. Every token is backed by native GMI held by this contract.
 */
contract GmiWrappedNative is ERC20, ReentrancyGuard {
    error ZeroAmount();
    error NativeTransferFailed();

    constructor() ERC20("Wrapped GMI", "wGMI") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}