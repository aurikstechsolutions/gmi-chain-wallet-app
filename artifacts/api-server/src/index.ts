import app from "./app";
import { logger } from "./lib/logger";
import {
  ensureDappsTable, ensureTokensTable, ensurePricesTable,
  ensureCardsTables, ensureTradingTables, ensureBotTables, ensureBacktestTable,
  ensureValidatorsTable, ensureValidatorBalancesTable,
  startBotLoop, startPricePoll,
} from "./routes";
import { startOrderSweep } from "./lib/orderSweep";
import { startTradeSweep } from "./lib/tradeSweep";
import { startCardDepositWatcher } from "./lib/cardDepositWatcher";
import { startBridgeRelayer } from "./lib/bridge";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Ensure all DB tables exist before accepting any traffic.
  // Previously these ran fire-and-forget, causing race conditions where the
  // first API requests would fail with "relation does not exist".
  logger.info("Initialising database tables…");
  // ensureCardsTables must run first — ensureBotTables inserts a row into card_accounts
  await ensureCardsTables();
  await Promise.all([
    ensureDappsTable(),
    ensureTokensTable(),
    ensurePricesTable(),
    ensureTradingTables(),
    ensureBotTables(),
    ensureBacktestTable(),
    ensureValidatorsTable(),
    ensureValidatorBalancesTable(),
  ]);
  logger.info("Database tables ready");

  startOrderSweep();
  startTradeSweep();
  startPricePoll();
  startBotLoop();
  startBridgeRelayer();
  logger.info("AlphaBot trading engine started");

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
