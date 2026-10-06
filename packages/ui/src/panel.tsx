import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** A surface with a border. `raised` adds the panel shadow, for things that float over others. */
export function panelClass({ raised = false }: { raised?: boolean } = {}): string {
  return cn("rounded-panel border border-line bg-surface", raised && "shadow-panel");
}

export function Panel({ raised, className, ...props }: HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return <div className={cn(panelClass({ raised }), className)} {...props} />;
}
