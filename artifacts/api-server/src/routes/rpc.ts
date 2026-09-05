import { Router } from "express";
import { GMI_RPC_URL } from "../lib/chain";

const router = Router();

function resolveRpcUrl(req: { headers: Record<string, string | string[] | undefined> }): string {
  const custom = req.headers["x-gmi-node"] ?? req.headers["x-gmi-rpc"] ?? req.headers["x-mchain-node"];
  if (typeof custom === "string" && custom.length > 0) {
    try {
      const u = new URL(custom);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return custom.replace(/\/$/, "");
      }
    } catch {
      // fall through
    }
  }
  return GMI_RPC_URL;
}

router.post("/rpc", async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const ALLOWED_METHODS = [
    "eth_blockNumber",
    "eth_call",
    "eth_getBalance",
    "eth_getCode",
    "eth_sendRawTransaction",
    "eth_getTransactionReceipt",
    "eth_getTransactionCount",
    "eth_gasPrice",
    "eth_chainId",
  ];
  if (!body || body.jsonrpc !== "2.0" || !ALLOWED_METHODS.includes(body.method as string)) {
    res.status(400).json({ error: `Unsupported method. Allowed: ${ALLOWED_METHODS.join(", ")}` });
    return;
  }

  try {
    const upstream = await fetch(resolveRpcUrl(req), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();

    res.setHeader("Content-Type", "application/json");
    res.status(upstream.ok ? 200 : upstream.status).send(text);
  } catch (err) {
    req.log.error({ err }, "rpc proxy failed");
    res.status(502).json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32603, message: "Internal error: upstream unavailable" },
    });
  }
});

export default router;
