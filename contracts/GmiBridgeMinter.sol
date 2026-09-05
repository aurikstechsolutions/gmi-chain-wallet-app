// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGmiWrappedAsset {
    function mintByBridge(address recipient, uint256 amount) external;
    function burnByBridge(address from, uint256 amount) external;
}

/**
 * @title GMI Bridge Minter
 * @notice Mints the wrapped representation after a finalized lockbox deposit
 *         and burns it when a user requests a transfer back to the canonical
 *         chain.
 */
contract GmiBridgeMinter is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IGmiWrappedAsset public immutable wrappedAsset;
    uint256 public immutable localChainId;
    uint256 public immutable remoteChainId;
    address public remoteBridge;

    mapping(bytes32 => bool) public processedMints;
    mapping(address => uint256) public withdrawalNonces;

    event RemoteBridgeUpdated(address indexed oldBridge, address indexed newBridge);
    event Mint(
        bytes32 indexed depositId,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 destinationChainId
    );
    event Withdrawal(
        bytes32 indexed withdrawalId,
        address indexed sender,
        uint256 amount,
        bytes32 destination,
        uint256 sourceChainId,
        uint256 destinationChainId,
        uint256 nonce
    );

    error InvalidAddress();
    error InvalidAmount();
    error InvalidChain();
    error AlreadyProcessed();
    error RemoteBridgeNotSet();

    constructor(
        address wrappedAsset_,
        uint256 localChainId_,
        uint256 remoteChainId_,
        address admin_,
        address relayer_,
        address pauser_
    ) {
        if (wrappedAsset_ == address(0) || admin_ == address(0) || relayer_ == address(0)) {
            revert InvalidAddress();
        }
        if (localChainId_ == 0 || remoteChainId_ == 0 || localChainId_ == remoteChainId_) {
            revert InvalidChain();
        }

        wrappedAsset = IGmiWrappedAsset(wrappedAsset_);
        localChainId = localChainId_;
        remoteChainId = remoteChainId_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, relayer_);
        _grantRole(PAUSER_ROLE, pauser_ == address(0) ? admin_ : pauser_);
    }

    function setRemoteBridge(address bridge_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridge_ == address(0)) revert InvalidAddress();
        emit RemoteBridgeUpdated(remoteBridge, bridge_);
        remoteBridge = bridge_;
    }

    /**
     * @dev Mint exactly once for a lockbox deposit observed by the relayer.
     * The wrapped token must grant this bridge MINTER_ROLE.
     */
    function mint(address recipient, uint256 amount, bytes32 depositId)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (depositId == bytes32(0)) revert InvalidAddress();
        if (processedMints[depositId]) revert AlreadyProcessed();
        if (remoteBridge == address(0)) revert RemoteBridgeNotSet();

        processedMints[depositId] = true;
        wrappedAsset.mintByBridge(recipient, amount);

        emit Mint(depositId, recipient, amount, remoteChainId, localChainId);
    }

    /**
     * @dev Burn wrapped tokens from the caller and emit a request for release
     * on the canonical chain. The destination is a 20-byte EVM address packed
     * into bytes32, so it cannot be confused with a GMI Bech32 string.
     */
    function withdraw(uint256 amount, bytes32 destination)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 withdrawalId)
    {
        if (amount == 0) revert InvalidAmount();
        if (destination == bytes32(0)) revert InvalidAddress();
        if (remoteBridge == address(0)) revert RemoteBridgeNotSet();

        uint256 nonce = withdrawalNonces[msg.sender]++;
        withdrawalId = keccak256(
            abi.encode(
                address(this),
                localChainId,
                remoteChainId,
                msg.sender,
                amount,
                destination,
                nonce
            )
        );

        wrappedAsset.burnByBridge(msg.sender, amount);

        emit Withdrawal(
            withdrawalId,
            msg.sender,
            amount,
            destination,
            localChainId,
            remoteChainId,
            nonce
        );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}