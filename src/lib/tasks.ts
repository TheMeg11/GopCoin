import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskClaims, tasks, type Task, type User } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { creditCoins } from "@/lib/ledger";
import { tgApi } from "@/lib/telegram";
import { effectiveStatus } from "@/lib/users";

export type TaskView = {
  id: number; title: string; description: string; type: string; verification: string; url: string | null;
  reward: number; status: "available" | "pending" | "completed" | "rejected" | "expired"; completedAt: Date | null;
  requirement: { kind: string; value: number; current: number } | null; expiresAt: Date | null;
};

function requirementCurrent(kind: string | null, u: User): number {
  if (kind === "level") return u.level;
  if (kind === "referrals") return u.referralCount;
  if (kind === "collected") return Math.floor(u.mineEarned / 1000); // whole GOP mined lifetime
  if (kind === "checkins") return u.collectedCount;
  return 0;
}

export async function listTasksForUser(u: User): Promise<TaskView[]> {
  const all = await db.select().from(tasks).orderBy(asc(tasks.sortOrder), asc(tasks.id));
  const claims = await db.select().from(taskClaims).where(eq(taskClaims.userId, u.id));
  const byTask = new Map(claims.map((c) => [c.taskId, c]));
  const now = Date.now();
  return all
    .filter((t) => t.active || byTask.get(t.id)?.status === "completed")
    .map((t) => {
      const c = byTask.get(t.id);
      const expired = !!t.expiresAt && t.expiresAt.getTime() < now;
      let status: TaskView["status"] = "available";
      if (c?.status === "completed") status = "completed";
      else if (c?.status === "pending") status = "pending";
      else if (expired) status = "expired";
      else if (c?.status === "rejected") status = "rejected";
      return {
        id: t.id, title: t.title, description: t.description, type: t.type, verification: t.verification, url: t.url,
        reward: c?.status === "completed" ? (c.reward ?? t.reward) : t.reward, status, completedAt: c?.completedAt ?? null,
        requirement: t.requirementKind && t.requirementValue ? { kind: t.requirementKind, value: t.requirementValue, current: requirementCurrent(t.requirementKind, u) } : null,
        expiresAt: t.expiresAt,
      };
    })
    .filter((t) => t.status !== "expired" || t.completedAt);
}

/** Complete a task + credit reward exactly once (claim unique index + ledger idempotency key). */
export async function completeClaim(taskId: number, userId: number, reward: number, reviewedBy: number | null) {
  return db.transaction(async (tx) => {
    const res = await tx
      .insert(taskClaims)
      .values({ taskId, userId, status: "completed", reward, completedAt: new Date(), reviewedBy })
      .onConflictDoUpdate({
        target: [taskClaims.taskId, taskClaims.userId],
        set: { status: "completed", reward, completedAt: new Date(), reviewedBy },
        where: sql`${taskClaims.status} <> 'completed'`,
      })
      .returning({ id: taskClaims.id });
    if (res.length === 0) return false;
    if (reward > 0) await creditCoins(tx, { userId, amount: reward, type: "task", key: `task:${taskId}:${userId}`, sourceRef: `task:${taskId}` });
    return true;
  });
}

async function verifyMembership(t: Task, telegramId: number): Promise<boolean> {
  if (!t.chatId) throw new ApiError(400, "TASK_MISCONFIGURED");
  const r = await tgApi<{ status: string; is_member?: boolean }>("getChatMember", { chat_id: t.chatId, user_id: telegramId });
  if (!r.ok || !r.result) throw new ApiError(503, "VERIFICATION_UNAVAILABLE", "Membership could not be verified right now. Try again later.");
  const s = r.result.status;
  return s === "creator" || s === "administrator" || s === "member" || (s === "restricted" && !!r.result.is_member);
}

export async function claimTask(u: User, taskId: number): Promise<{ status: "completed" | "pending"; reward: number }> {
  if (effectiveStatus(u) !== "active") throw new ApiError(403, "EARNING_SUSPENDED", "Rewards are unavailable for this account");
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || !t.active) throw new ApiError(404, "TASK_NOT_FOUND");
  if (t.expiresAt && t.expiresAt.getTime() < Date.now()) throw new ApiError(410, "TASK_EXPIRED", "This task has expired");
  const [existing] = await db.select().from(taskClaims).where(and(eq(taskClaims.taskId, taskId), eq(taskClaims.userId, u.id))).limit(1);
  if (existing?.status === "completed") return { status: "completed", reward: existing.reward ?? t.reward };
  if (existing?.status === "pending") return { status: "pending", reward: t.reward };

  if (t.verification === "auto") {
    const cur = requirementCurrent(t.requirementKind, u);
    if (!t.requirementKind || !t.requirementValue || cur < t.requirementValue) throw new ApiError(400, "REQUIREMENT_NOT_MET", "You haven't met this task's requirement yet");
    await completeClaim(t.id, u.id, t.reward, null);
    return { status: "completed", reward: t.reward };
  }
  if (t.verification === "telegram_member") {
    if (!(await verifyMembership(t, u.telegramId))) throw new ApiError(400, "NOT_A_MEMBER", "Join first, then tap Verify");
    await completeClaim(t.id, u.id, t.reward, null);
    return { status: "completed", reward: t.reward };
  }
  // Manual verification: submit for administrator review — never auto-rewarded.
  await db
    .insert(taskClaims)
    .values({ taskId: t.id, userId: u.id, status: "pending" })
    .onConflictDoUpdate({ target: [taskClaims.taskId, taskClaims.userId], set: { status: "pending", createdAt: new Date() }, where: sql`${taskClaims.status} = 'rejected'` });
  return { status: "pending", reward: t.reward };
}
