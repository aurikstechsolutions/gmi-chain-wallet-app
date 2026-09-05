// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGmiAmmFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IGmiAmmPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swapFeeBps() external view returns (uint16);
    function getReserves() external view returns (uint112, uint112, uint32);
    function mint(address to) external returns (uint256);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;
}

interface IGmiWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/**
 * @title GMI AMM Router
 * @notice User-facing router for curated constant-product pools.
 *
 * The router supports exact-input swaps and liquidity operations. Every
 * mutating operation has caller-provided minimums and a deadline.
 */
contract GmiAmmRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    IGmiAmmFactory public immutable factory;
    address public immutable wrappedNative;

    error Expired();
    error InvalidPath();
    error PairNotFound();
    error InsufficientAmount();
    error InsufficientOutput();
    error InvalidRecipient();
    error ExcessiveInput();
    error NativeTransferFailed();

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert Expired();
        _;
    }

    constructor(address factory_, address wrappedNative_) {
        if (factory_ == address(0) || wrappedNative_ == address(0)) revert InvalidRecipient();
        factory = IGmiAmmFactory(factory_);
        wrappedNative = wrappedNative_;
    }

    receive() external payable {
        if (msg.sender != wrappedNative) revert NativeTransferFailed();
    }

    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) public pure returns (uint256 amountB) {
        if (amountA == 0 || reserveA == 0 || reserveB == 0) revert InsufficientAmount();
        amountB = amountA * reserveB / reserveA;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint16 feeBps
    ) public pure returns (uint256 amountOut) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert InsufficientAmount();
        if (feeBps >= FEE_DENOMINATOR) revert InsufficientAmount();
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - feeBps);
        amountOut = amountInWithFee * reserveOut /
            (reserveIn * FEE_DENOMINATOR + amountInWithFee);
        if (amountOut == 0) revert InsufficientOutput();
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint16 feeBps
    ) public pure returns (uint256 amountIn) {
        if (amountOut == 0 || reserveIn == 0 || reserveOut <= amountOut) {
            revert InsufficientAmount();
        }
        if (feeBps >= FEE_DENOMINATOR) revert InsufficientAmount();
        uint256 numerator = reserveIn * amountOut * FEE_DENOMINATOR;
        uint256 denominator = (reserveOut - amountOut) * (FEE_DENOMINATOR - feeBps);
        amountIn = numerator / denominator + 1;
    }

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts) {
        amounts = _getAmountsOut(amountIn, path);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (to == address(0)) revert InvalidRecipient();
        address pair = _pair(tokenA, tokenB);
        (amountA, amountB) = _optimalLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            pair
        );
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = IGmiAmmPair(pair).mint(to);
    }

    function addLiquidityNative(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (
        uint256 amountToken,
        uint256 amountNative,
        uint256 liquidity
    ) {
        if (to == address(0) || token == wrappedNative) revert InvalidRecipient();
        address pair = _pair(token, wrappedNative);
        (amountToken, amountNative) = _optimalLiquidity(
            token,
            wrappedNative,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountNativeMin,
            pair
        );
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IGmiWrappedNative(wrappedNative).deposit{value: amountNative}();
        IERC20(wrappedNative).safeTransfer(pair, amountNative);
        if (msg.value > amountNative) _sendNative(msg.sender, msg.value - amountNative);
        liquidity = IGmiAmmPair(pair).mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        if (to == address(0)) revert InvalidRecipient();
        address pair = _pair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IGmiAmmPair(pair).burn(to);
        (amountA, amountB) = tokenA < tokenB ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin || amountB < amountBMin) revert InsufficientOutput();
    }

    function removeLiquidityNative(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountToken, uint256 amountNative) {
        if (to == address(0) || token == wrappedNative) revert InvalidRecipient();
        address pair = _pair(token, wrappedNative);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IGmiAmmPair(pair).burn(address(this));
        (uint256 tokenAmount, uint256 nativeAmount) = token < wrappedNative
            ? (amount0, amount1)
            : (amount1, amount0);
        if (tokenAmount < amountTokenMin || nativeAmount < amountNativeMin) {
            revert InsufficientOutput();
        }
        IERC20(token).safeTransfer(to, tokenAmount);
        IGmiWrappedNative(wrappedNative).withdraw(nativeAmount);
        _sendNative(to, nativeAmount);
        return (tokenAmount, nativeAmount);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        if (to == address(0)) revert InvalidRecipient();
        amounts = _getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        address firstPair = _pair(path[0], path[1]);
        IERC20(path[0]).safeTransferFrom(msg.sender, firstPair, amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactNativeForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        if (to == address(0) || path.length < 2 || path[0] != wrappedNative) revert InvalidPath();
        amounts = _getAmountsOut(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IGmiWrappedNative(wrappedNative).deposit{value: msg.value}();
        IERC20(wrappedNative).safeTransfer(_pair(path[0], path[1]), msg.value);
        _swap(amounts, path, to);
    }

    function swapExactTokensForNative(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        if (to == address(0) || path.length < 2 || path[path.length - 1] != wrappedNative) {
            revert InvalidPath();
        }
        amounts = _getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        if (amountOut < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amountIn);
        _swap(amounts, path, address(this));
        IGmiWrappedNative(wrappedNative).withdraw(amountOut);
        _sendNative(to, amountOut);
    }

    function _optimalLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address pair
    ) private view returns (uint256 amountA, uint256 amountB) {
        if (amountADesired == 0 || amountBDesired == 0) revert InsufficientAmount();
        (uint256 reserveA, uint256 reserveB) = _reservesFor(pair, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
        } else if (reserveA == 0 || reserveB == 0) {
            revert InsufficientAmount();
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientAmount();
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                if (amountAOptimal > amountADesired || amountAOptimal < amountAMin) {
                    revert InsufficientAmount();
                }
                amountA = amountAOptimal;
                amountB = amountBDesired;
            }
        }
        if (amountA < amountAMin || amountB < amountBMin) revert InsufficientAmount();
    }

    function _getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) private view returns (uint256[] memory amounts) {
        if (amountIn == 0 || path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = _pair(path[i], path[i + 1]);
            (uint256 reserveIn, uint256 reserveOut) = _reservesFor(pair, path[i], path[i + 1]);
            amounts[i + 1] = IGmiAmmPair(pair).swapFeeBps() == 0
                ? getAmountOut(amounts[i], reserveIn, reserveOut, 0)
                : getAmountOut(amounts[i], reserveIn, reserveOut, IGmiAmmPair(pair).swapFeeBps());
        }
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address to) private {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address input = path[i];
            address output = path[i + 1];
            address pair = _pair(input, output);
            (uint256 amount0Out, uint256 amount1Out) = input < output
                ? (uint256(0), amounts[i + 1])
                : (amounts[i + 1], uint256(0));
            address nextTo = i < path.length - 2 ? _pair(output, path[i + 2]) : to;
            IGmiAmmPair(pair).swap(amount0Out, amount1Out, nextTo);
        }
    }

    function _reservesFor(
        address pair,
        address tokenA,
        address tokenB
    ) private view returns (uint256 reserveA, uint256 reserveB) {
        (uint112 reserve0, uint112 reserve1, ) = IGmiAmmPair(pair).getReserves();
        if (tokenA < tokenB) return (reserve0, reserve1);
        return (reserve1, reserve0);
    }

    function _pair(address tokenA, address tokenB) private view returns (address pair) {
        pair = IGmiAmmFactory(address(factory)).getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairNotFound();
    }

    function _sendNative(address to, uint256 amount) private {
        (bool sent, ) = payable(to).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }
}