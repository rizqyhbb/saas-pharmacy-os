import { Pill } from "@phosphor-icons/react/ssr";
import { cn } from "./cn";

/** Product mark: a pill glyph on an accent tile, then the name. */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[1.05rem] font-semibold tracking-[-0.015em] text-ink", className)}>
      <span aria-hidden className="grid size-[30px] place-items-center rounded-control bg-accent text-accent-ink">
        <Pill className="size-[18px]" weight="bold" />
      </span>
      {name}
    </span>
  );
}
