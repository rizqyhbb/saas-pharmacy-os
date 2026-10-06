import type { ReactNode } from "react";
import { cn } from "./cn";

/** On/off control. The visible state label sits next to the track. */
export function Switch({
  checked,
  onChange,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex items-center gap-2.5 rounded-control p-1 text-[0.92rem] font-medium", className)}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-[42px] rounded-full transition-colors duration-150",
          checked ? "bg-accent" : "bg-[color-mix(in_oklab,var(--muted)_70%,var(--line))]",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-[18px] rounded-full bg-surface transition-[left] duration-150",
            checked ? "left-[21px]" : "left-[3px]",
          )}
        />
      </span>
      {children}
    </button>
  );
}
