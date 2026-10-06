import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Status chips. Tones carry meaning, never decoration:
 * - `next`: the one thing that happens next (the batch that sells next, the current stage)
 * - `ok`: healthy state
 * - `warn`: needs attention soon (near expiry, waiting to sync)
 * - `danger`: blocked or wrong (expired, prescription-only at the till)
 * - `neutral` / `outline`: labels without a state
 */
export type ChipTone = "neutral" | "outline" | "next" | "ok" | "warn" | "danger";

const tones: Record<ChipTone, string> = {
  neutral: "bg-sunk text-muted",
  outline: "border border-line text-muted",
  next: "bg-accent text-accent-ink",
  ok: "bg-accent-soft text-accent-soft-ink",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function chipClass(tone: ChipTone = "neutral"): string {
  return cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.76rem] font-medium leading-[1.35]",
    tones[tone],
  );
}

export function Chip({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return <span className={cn(chipClass(tone), className)} {...props} />;
}
