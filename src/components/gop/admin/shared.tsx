"use client";

import type { ReactNode } from "react";
import { api } from "../client";

export const adm = <T,>(path: string, json?: unknown, method?: string) => api<T>(`/api/admin/${path}`, { json, method: method ?? (json !== undefined ? "POST" : "GET") });

export function Panel({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card rounded-2xl p-4">
      {(title || right) && <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-extrabold uppercase tracking-wider text-white/60">{title}</h3>{right}</div>}
      {children}
    </section>
  );
}
