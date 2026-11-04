import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function handleError(e: unknown) {
  if (e instanceof ApiError) return json({ error: e.code, message: e.message }, e.status);
  if (e instanceof ZodError)
    return json({ error: "INVALID_INPUT", message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).slice(0, 5).join("; ") }, 400);
  console.error("[api] unexpected error", e);
  return json({ error: "INTERNAL", message: "Something went wrong" }, 500);
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

export function route<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      return handleError(e);
    }
  };
}
