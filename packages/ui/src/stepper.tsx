import { Minus, Plus } from "@phosphor-icons/react/ssr";
import { cn } from "./cn";

/** Quantity stepper: minus, value, plus. The value is display-only. */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  size = "md",
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  size?: "md" | "sm";
}) {
  const button = cn(
    "grid place-items-center rounded-control text-muted transition-[background-color,color,transform] hover:bg-sunk hover:text-ink active:scale-95",
    size === "md" ? "size-11" : "size-8",
  );
  return (
    <span className="inline-flex items-center rounded-control border border-line bg-surface">
      <button type="button" aria-label={decrementLabel} className={button} onClick={onDecrement}>
        <Minus aria-hidden className="size-3.5" weight="bold" />
      </button>
      <span className={cn("text-center font-mono tabular-nums", size === "md" ? "w-10 text-base" : "w-7 text-[0.88rem]")}>
        {value}
      </span>
      <button type="button" aria-label={incrementLabel} className={button} onClick={onIncrement}>
        <Plus aria-hidden className="size-3.5" weight="bold" />
      </button>
    </span>
  );
}
