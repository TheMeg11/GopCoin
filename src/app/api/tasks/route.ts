import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { ApiError, json, readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/risk";
import { claimTask, listTasksForUser } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const { user } = await requireUser(req);
  return json({ tasks: await listTasksForUser(user) });
});

export const POST = route(async (req: Request) => {
  const { user } = await requireUser(req);
  const cfg = await getConfig();
  if (!cfg.features.tasks) throw new ApiError(403, "TASKS_DISABLED");
  if (!rateLimit(`task:${user.id}`, 20, 60_000)) {
    await recordSecurityEvent({ userId: user.id, type: "task_claim_spam", flagThreshold: cfg.risk.flagThreshold });
    throw new ApiError(429, "RATE_LIMITED", "Too many claim attempts");
  }
  const { taskId } = z.object({ taskId: z.number().int().positive() }).parse(await readJson(req, 1024));
  const r = await claimTask(user, taskId);
  return json(r);
});
