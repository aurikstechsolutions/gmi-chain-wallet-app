import { Router } from "express";
import { getAmmPublicConfig } from "../lib/amm";

const router = Router();

router.get("/amm/config", (_req, res) => {
  res.json(getAmmPublicConfig());
});

export default router;