// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GMI Bridge Lockbox
 * @notice Holds the canonical ERC-20 on the source chain and releases it after
 *         the trusted bridge relayer observes a finalized burn on GMI.
 *
 * Deploy one instance on the canonical-asset chain (for example BSC). The
 * relayer is deliberately a separate role from the administrator and can only
 * release funds with an unused withdrawal id.
 */
contract GmiBridgeLockbox is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant LIQUIDITY_ROLE = keccak256("LIQUIDITY_ROLE");

    IERC20 public immutable canonicalToken;
    uint256 public immutable localChainId;
    uint256 public immutable remoteChainId;
    address public remoteBridge;

    mapping(address => uint256) public depositNonces;
    mapping(bytes32 => bool) public processedWithdrawals;

    event RemoteBridgeUpdated(address indexed oldBridge, address indexed newBridge);
    event Deposit(
        bytes32 indexed depositId,
        address indexed sender,
        uint256 amount,
        bytes32 destination,
        uint256 sourceChainId,
        uint256 destinationChainId,
        uint256 nonce
    );
    event Release(
        bytes32 indexed withdrawalId,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 destinationChainId
    );

    error InvalidAddress();
    error InvalidAmount();
    error InvalidChain();
    error UnknownWithdrawal();
    error AlreadyProcessed();
    error RemoteBridgeNotSet();

    constructor(
        address token_,
        uint256 localChainId_,
        uint256 remoteChainId_,
        address admin_,
        address relayer_,
        address pauser_,
        address liquidityManager_
    ) {
        if (token_ == address(0) || admin_ == address(0) || relayer_ == address(0)) {
            revert InvalidAddress();
        }
        if (localChainId_ == 0 || remoteChainId_ == 0 || localChainId_ == remoteChainId_) {
            revert InvalidChain();
        }

        canonicalToken = IERC20(token_);
        localChainId = localChainId_;
        remoteChainId = remoteChainId_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, relayer_);
        _grantRole(PAUSER_ROLE, pauser_ == address(0) ? admin_ : pauser_);
        _grantRole(
            LIQUIDITY_ROLE,
            liquidityManager_ == address(0) ? admin_ : liquidityManager_
        );
    }

    function setRemoteBridge(address bridge_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridge_ == address(0)) revert InvalidAddress();
        emit RemoteBridgeUpdated(remoteBridge, bridge_);
        remoteBridge = bridge_;
    }

    /**
     * @dev Lock canonical tokens and emit a deterministic cross-chain request.
     * `destination` is the 20-byte EVM address left-padded to bytes32. The
     * frontend accepts gmi1 addresses but converts them before this call.
     */
    function deposit(uint256 amount, bytes32 destination)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 depositId)
    {
        if (amount == 0) revert InvalidAmount();
        if (destination == bytes32(0)) revert InvalidAddress();
        if (remoteBridge == address(0)) revert RemoteBridgeNotSet();

        uint256 nonce = depositNonces[msg.sender]++;
        depositId = keccak256(
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

        canonicalToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(
            depositId,
            msg.sender,
            amount,
            destination,
            localChainId,
            remoteChainId,
            nonce
        );
    }

    /**
     * @dev Release canonical tokens after a relayer has verified a GMI burn.
     * The withdrawal id is the source-chain event id and is never reusable.
     */
    function release(address recipient, uint256 amount, bytes32 withdrawalId)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (withdrawalId == bytes32(0)) revert UnknownWithdrawal();
        if (processedWithdrawals[withdrawalId]) revert AlreadyProcessed();
        if (remoteBridge == address(0)) revert RemoteBridgeNotSet();

        processedWithdrawals[withdrawalId] = true;
        canonicalToken.safeTransfer(recipient, amount);

        emit Release(
            withdrawalId,
            recipient,
            amount,
            remoteChainId,
            localChainId
        );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Emergency recovery is intentionally restricted and should only be
     * used while paused under the operator's documented incident procedure.
     */
    function emergencyWithdraw(address token, address recipient, uint256 amount)
        external
        onlyRole(LIQUIDITY_ROLE)
        whenPaused
    {
        if (token == address(0) || recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransfer(recipient, amount);
    }
}