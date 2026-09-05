// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title GMI AMM Pair
 * @notice Constant-product ERC-20 pair with a permanently fixed swap fee.
 *
 * The pair deliberately has no flash-swap callback. The router is the only
 * supported swap entry point for the initial AMM deployment.
 */
contract GmiAmmPair is ERC20 {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    // OpenZeppelin ERC20 v5 rejects _mint(address(0), ...). This non-zero
    // holder permanently locks the minimum liquidity without a burn call.
    address public constant LOCKED_LIQUIDITY_HOLDER = address(1);
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_SWAP_FEE_BPS = 100;

    address public immutable factory;
    address public token0;
    address public token1;
    uint16 public swapFeeBps;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 private unlocked = 1;

    error Forbidden();
    error AlreadyInitialized();
    error InvalidTokens();
    error InvalidFee();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutput();
    error InsufficientInput();
    error InvalidRecipient();
    error ReserveOverflow();
    error InvariantViolation();

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    modifier lock() {
        if (unlocked != 1) revert Forbidden();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address factory_) ERC20("GMI AMM Liquidity", "GMI-LP") {
        if (factory_ == address(0)) revert InvalidRecipient();
        factory = factory_;
    }

    function initialize(address token0_, address token1_, uint16 feeBps) external {
        if (msg.sender != factory) revert Forbidden();
        if (token0 != address(0)) revert AlreadyInitialized();
        if (token0_ == address(0) || token1_ == address(0) || token0_ == token1_) {
            revert InvalidTokens();
        }
        if (token0_ > token1_) revert InvalidTokens();
        if (feeBps > MAX_SWAP_FEE_BPS) revert InvalidFee();
        token0 = token0_;
        token1 = token1_;
        swapFeeBps = feeBps;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function mint(address to) external lock returns (uint256 liquidity) {
        if (to == address(0)) revert InvalidRecipient();
        (uint112 _reserve0, uint112 _reserve1, ) = _getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(LOCKED_LIQUIDITY_HOLDER, MINIMUM_LIQUIDITY);
        } else {
            if (_reserve0 == 0 || _reserve1 == 0) revert InsufficientLiquidityMinted();
            liquidity = Math.min(
                amount0 * supply / _reserve0,
                amount1 * supply / _reserve1
            );
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        (uint112 _reserve0, uint112 _reserve1, ) = _getReserves();
        address _token0 = token0;
        address _token1 = token1;
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();

        amount0 = liquidity * balance0 / supply;
        amount1 = liquidity * balance1 / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
        _burn(address(this), liquidity);
        IERC20(_token0).safeTransfer(to, amount0);
        IERC20(_token1).safeTransfer(to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
        // Silence unused-variable warnings while retaining the reserve snapshot
        // in the function for readability and future audit comparison.
        _reserve0;
        _reserve1;
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutput();
        (uint112 _reserve0, uint112 _reserve1, ) = _getReserves();
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert InsufficientOutput();
        if (to == address(0) || to == token0 || to == token1 || to == address(this)) {
            revert InvalidRecipient();
        }

        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > uint256(_reserve0) - amount0Out
            ? balance0 - (uint256(_reserve0) - amount0Out)
            : 0;
        uint256 amount1In = balance1 > uint256(_reserve1) - amount1Out
            ? balance1 - (uint256(_reserve1) - amount1Out)
            : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInput();

        uint256 adjustedBalance0 = balance0 * FEE_DENOMINATOR - amount0In * swapFeeBps;
        uint256 adjustedBalance1 = balance1 * FEE_DENOMINATOR - amount1In * swapFeeBps;
        if (
            adjustedBalance0 * adjustedBalance1 <
            uint256(_reserve0) * uint256(_reserve1) * FEE_DENOMINATOR * FEE_DENOMINATOR
        ) {
            revert InvariantViolation();
        }

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function skim(address to) external lock {
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        IERC20(token0).safeTransfer(to, IERC20(token0).balanceOf(address(this)) - reserve0);
        IERC20(token1).safeTransfer(to, IERC20(token1).balanceOf(address(this)) - reserve1);
    }

    function sync() external lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _getReserves() internal view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) {
            revert ReserveOverflow();
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }
}