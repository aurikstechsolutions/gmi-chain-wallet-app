import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBridgeQuote,
  formatBridgeUnits,
  packedAddressToEvm,
  parseBridgeUnits,
  toPackedAddress,
} from "./bridge-utils";
import type { BridgeRuntimeConfig } from "./bridge";

const testConfig: BridgeRuntimeConfig = {
  enabled: true,
  bscRpcUrl: "https://bsc.example",
  gmiRpcUrl: "https://gmi.example",
  bscBridgeAddress: "0x1111111111111111111111111111111111111111",
  bscTokenAddress: "0x2222222222222222222222222222222222222222",
  gmiBridgeAddress: "0x3333333333333333333333333333333333333333",
  gmiTokenAddress: "0x4444444444444444444444444444444444444444",
  bscTokenDecimals: 6,
  gmiTokenDecimals: 18,
  feeBps: 100,
  minAmount: "1",
  confirmations: 2,
  relayerConfigured: true,
  missing: [],
};

test("bridge units preserve decimal precision", () => {
  assert.equal(parseBridgeUnits("12.345001", 6), 12_345_001n);
  assert.equal(formatBridgeUnits(12_345_001n, 6), "12.345001");
  assert.throws(() => parseBridgeUnits("1.0000001", 6), /decimal places/);
});

test("bridge quote applies an integer fee", () => {
  const quote = calculateBridgeQuote("10", "bsc", testConfig);
  assert.deepEqual(quote, {
    grossAmount: "10",
    feeAmount: "0.1",
    netAmount: "9.9",
    feeBps: 100,
  });
});

test("bridge destinations round-trip as packed EVM addresses", () => {
  const address = "0x1234567890123456789012345678901234567890";
  const packed = toPackedAddress(address);
  assert.equal(
    packed,
    "0x0000000000000000000000001234567890123456789012345678901234567890",
  );
  assert.equal(packedAddressToEvm(packed), address);
  assert.throws(
    () => packedAddressToEvm("0x1234" as `0x${string}`),
    /invalid destination/i,
  );
});
