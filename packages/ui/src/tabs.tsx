import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "./cn";

export type TabItem<T extends string> = { id: T; label: ReactNode };

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Tab list with roving focus: arrow keys, Home and End move and select.
 * Pair with `tabPanelProps(idPrefix, value)` on the visible panel.
 */
export function Tabs<T extends string>({
  idPrefix,
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  idPrefix: string;
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const select = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]!;
    onChange(tab.id);
    document.getElementById(tabId(idPrefix, tab.id))?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex max-w-full gap-1 rounded-control bg-sunk p-[3px]", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={tabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-1.5 py-2 text-[0.84rem] transition-colors sm:flex-none sm:px-3 sm:text-[0.9rem]",
              selected ? "bg-surface font-medium text-ink shadow-control" : "text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(idPrefix: string, id: string) {
  return { role: "tabpanel", id: panelId(idPrefix, id), "aria-labelledby": tabId(idPrefix, id), tabIndex: 0 } as const;
}
