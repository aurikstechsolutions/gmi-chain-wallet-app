---
name: Bridge premint policy
description: How to treat the intentionally unbacked GMI wUSDT premint
---

The owner explicitly requested an intentionally unbacked wUSDT premint for use inside GMI. It is not reserve-backed and should not be represented as redeemable BSC liquidity.

**Why:** The owner plans to use the preminted amount on GMI only, while the bridge’s normal supply remains backed 1:1 by canonical USDT locked on BSC.

**How to apply:** Keep the preminted allocation separate from bridge-liquidity calculations and communicate that attempting to redeem it through GMI → BSC could fail without additional BSC reserves. Do not add more preminted supply without explicit confirmation.