"use client";

import { useFormStatus } from "react-dom";
import { runNow } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Running… (up to a few minutes)" : "Run now"}
    </button>
  );
}

export function RunButton() {
  return (
    <form action={runNow} className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-sm text-muted">
        <input type="checkbox" name="email" className="accent-current" /> email it
      </label>
      <Submit />
    </form>
  );
}
