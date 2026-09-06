// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GmiAmmPair} from "./GmiAmmPair.sol";

/**
 * @title GMI AMM Factory
 * @notice Creates the curated, immutable pair contracts used by the router.
 */
contract GmiAmmFactory is Ownable2Step {
    uint256 public constant MAX_SWAP_FEE_BPS = 100;

    uint16 public immutable swapFeeBps;
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    error InvalidToken();
    error InvalidFee();
    error PairAlreadyExists();

    event PairCreated(
        address indexed token0,
        address indexed token1,
        address pair,
        uint256 pairCount
    );

    constructor(uint16 swapFeeBps_, address initialOwner) Ownable(initialOwner) {
        if (swapFeeBps_ > MAX_SWAP_FEE_BPS) revert InvalidFee();
        if (initialOwner == address(0)) revert InvalidToken();
        swapFeeBps = swapFeeBps_;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external onlyOwner returns (address pair) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) {
            revert InvalidToken();
        }
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        if (getPair[token0][token1] != address(0)) revert PairAlreadyExists();

        pair = address(new GmiAmmPair(address(this)));
        GmiAmmPair(pair).initialize(token0, token1, swapFeeBps);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}