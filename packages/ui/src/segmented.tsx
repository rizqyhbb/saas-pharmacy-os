import { cn } from "./cn";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * Single choice from a few options (units, modes). Native radio inputs, so arrow
 * keys and screen readers work without extra code. Controlled.
 */
export function Segmented<T extends string>({
  name,
  legend,
  hideLegend = false,
  options,
  value,
  onChange,
  size = "md",
}: {
  name: string;
  legend: string;
  hideLegend?: boolean;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={hideLegend ? "sr-only" : "mb-2 text-[0.82rem] font-medium text-muted"}>{legend}</legend>
      <div className="inline-flex gap-0.5 rounded-control bg-sunk p-[3px]">
        {options.map((option) => (
          <span key={option.value} className="relative">
            <input
              type="radio"
              className="peer absolute size-px opacity-0"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <label
              htmlFor={`${name}-${option.value}`}
              className={cn(
                "block cursor-pointer rounded-[6px] text-muted transition-colors hover:text-ink peer-checked:bg-surface peer-checked:font-medium peer-checked:text-ink peer-checked:shadow-control peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent",
                size === "md" ? "px-3.5 py-2 text-[0.92rem]" : "px-2.5 py-1 text-[0.82rem]",
              )}
            >
              {option.label}
            </label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}
