"use server";

import { redirect } from "next/navigation";
import { loadProfile } from "@/lib/config";
import { ensureSchema } from "@/lib/db";
import { EDITABLE_LISTS, parseList, setListOverride } from "@/lib/settings";

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v.toLowerCase() === b[i].toLowerCase());

export async function saveList(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const list = EDITABLE_LISTS.find((l) => l.key === key);
  if (!list) throw new Error(`Unknown list ${key}`);
  await ensureSchema();
  const defaults = list.get(loadProfile().config);
  if (formData.get("reset") === "1") {
    await setListOverride(key, null);
  } else {
    const value = parseList(String(formData.get("value") ?? ""));
    // Saving the defaults back unchanged just clears the override.
    await setListOverride(key, same(value, defaults) ? null : value);
  }
  redirect(`/keywords?saved=${key}#${key}`);
}
