/**
 * Background sweep: auto-cancel orders whose payment window has expired.
 * Runs every 60 seconds. For BUY-ad orders the seller's locked escrow
 * is refunded on-chain; for SELL-ad orders the available amount is
 * simply restored (the ad-level escrow pool stays intact).
 */
import { db } from "@workspace/db";
import { p2pOrders, p2pAds, p2pMessages } from "@workspace/db";
import { eq, and, lt, sql, inArray } from "drizzle-orm";
import {
  broadcastMcTransaction, broadcastUsdtTransaction,
  isEscrowConfigured, getEscrowAddress, getEscrowPrivateKey,
} from "../escrow";
import { mcToWei } from "../escrow";
import { logger } from "./logger";

async function sweepOnce() {
  const now = new Date();

  // Find all orders that have passed their deadline and are still pending
  const expired = await db
    .select({
      order: p2pOrders,
      adSide: p2pAds.side,
      adToken: p2pAds.token,
    })
    .from(p2pOrders)
    .innerJoin(p2pAds, eq(p2pOrders.adId, p2pAds.id))
    .where(
      and(
        eq(p2pOrders.status, "pending"),
        lt(p2pOrders.paymentDeadline, now),
      ),
    );

  if (expired.length === 0) return;

  logger.info({ count: expired.length }, "Sweeping expired orders");

  for (const { order, adSide, adToken } of expired) {
    try {
      let refundTxHash: string | null = null;

      // BUY-ad orders: seller locked their own funds at order creation — refund them
      if (adSide === "buy" && order.escrowStatus === "locked" && isEscrowConfigured()) {
        try {
          const escrowPk   = getEscrowPrivateKey();
          const escrowAddr = getEscrowAddress();
          const amount     = String(order.cryptoAmount);
          if (adToken === "MC") {
            refundTxHash = await broadcastMcTransaction(escrowAddr, order.sellerAddress, mcToWei(amount), escrowPk);
          } else {
            refundTxHash = await broadcastUsdtTransaction(escrowPk, order.sellerAddress, amount);
          }
          logger.info({ orderId: order.id, refundTxHash }, "Escrow refunded on timeout");
        } catch (e) {
          logger.error({ orderId: order.id, err: e }, "Failed to refund escrow on timeout — skipping");
          continue; // don't cancel if the refund TX fails; retry next sweep
        }
      }

      // Cancel the order
      await db.update(p2pOrders).set({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: "Payment window expired — order auto-cancelled",
        escrowStatus: refundTxHash ? "refunded" : order.escrowStatus,
        updatedAt: now,
      }).where(eq(p2pOrders.id, order.id));

      // Restore available amount on the ad
      await db.update(p2pAds).set({
        availableAmount: sql`${p2pAds.availableAmount} + ${order.cryptoAmount}`,
        updatedAt: now,
      }).where(eq(p2pAds.id, order.adId));

      // System message in the trade room
      const msg = refundTxHash
        ? `Order cancelled — payment window expired. Seller's escrow has been refunded (tx: ${refundTxHash.slice(0, 14)}…).`
        : "Order cancelled — payment window expired. No payment was received.";

      await db.insert(p2pMessages).values({
        orderId: order.id,
        senderAddress: "system",
        content: msg,
        isSystem: true,
      });

      logger.info({ orderId: order.id, refundTxHash }, "Expired order cancelled");
    } catch (e) {
      logger.error({ orderId: order.id, err: e }, "Error processing expired order");
    }
  }
}

export function startOrderSweep(intervalMs = 60_000) {
  // Run immediately on startup, then on the interval
  void sweepOnce().catch(e => logger.error({ err: e }, "Initial order sweep failed"));
  setInterval(() => {
    void sweepOnce().catch(e => logger.error({ err: e }, "Order sweep failed"));
  }, intervalMs);
  logger.info({ intervalMs }, "Order sweep started");
}
