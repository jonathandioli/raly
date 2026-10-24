"use server";

import { refresh } from "next/cache";
import { setStatus } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline";
import type { MarkStatus } from "@/lib/types";

const STATUSES = new Set(["applied", "skip", "saved", "clear"]);

export async function markPosting(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.has(status)) throw new Error("Bad mark request");
  await setStatus(id, status === "clear" ? null : (status as MarkStatus));
  refresh();
}

export async function runNow(formData: FormData) {
  await runPipeline({ kind: "manual", email: formData.get("email") === "on" });
  refresh();
}
