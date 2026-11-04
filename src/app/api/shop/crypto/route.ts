import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { MILLI } from "@/lib/mine";
import { createCryptoOrder, expectedAssetAmount, findCryptoPackage, listUserCryptoOrders, noteCryptoSubmission, notifyNewCryptoOrder } from "@/lib/shop";
import { ApiError, json, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/risk";
import { displayName } from "@/lib/users";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  packageId: z.string().regex(/^[a-z0-9_]{1,24}$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

/** User's own crypto orders. */
export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const orders = await listUserCryptoOrders(user.id);
  return json({
    orders: orders.map((o) => ({
      id: o.id, packageId: o.packageId, gopAmount: o.gopAmount, usdAmount: o.usdAmount,
      assetSymbol: o.assetSymbol, assetAmount: o.assetAmount, address: o.address, txHash: o.txHash,
      status: o.status, createdAt: o.createdAt, decidedAt: o.decidedAt, note: o.note,
    })),
  });
});

/** Submit a paid transaction for verification. One TX hash can ever be used once. */
export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const cfg = await getConfig();
  if (!cfg.features.shop || !cfg.payments.crypto.enabled) throw new ApiError(403, "CRYPTO_DISABLED", "Crypto payments are disabled right now");
  if (!rateLimit(`crypto:${user.id}`, 6, 60_000)) {
    await recordSecurityEvent({ userId: user.id, type: "crypto_order_spam", flagThreshold: cfg.risk.flagThreshold });
    throw new ApiError(429, "RATE_LIMITED", "Too many submissions, slow down");
  }
  const body = bodySchema.parse(await readJson(req, 2048));
  const pkg = findCryptoPackage(cfg, body.packageId);
  if (!pkg) throw new ApiError(400, "BAD_PACKAGE", "Unknown package");
  const order = await createCryptoOrder({ userId: user.id, packageId: body.packageId, txHash: body.txHash, cfg });
  void noteCryptoSubmission(user.id, cfg.risk.flagThreshold);
  void notifyNewCryptoOrder(order, displayName(user));
  return json({
    order: {
      id: order.id, packageId: order.packageId, gopAmount: order.gopAmount, usdAmount: order.usdAmount,
      assetSymbol: order.assetSymbol, assetAmount: order.assetAmount, address: order.address,
      txHash: order.txHash, status: order.status, createdAt: order.createdAt,
    },
    expectedAssetAmount: expectedAssetAmount(pkg, cfg),
    gopAmount: pkg.gop,
    milli: MILLI,
  });
});
