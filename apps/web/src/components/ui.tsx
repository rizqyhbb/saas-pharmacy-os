import type { CSSProperties, ReactNode } from "react";
import { cn } from "@apotek/ui";

/** Delay index for the `.enter` load-in cascade in globals.css. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Page width: 1200px of content, 40px gutters (28px tablet, 20px phone). */
export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1280px] px-5 md:px-7 lg:px-10", className)}>{children}</div>;
}

/** The one small uppercase label a section may carry (max one per three sections). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3.5 text-[0.78rem] font-medium uppercase tracking-[0.12em] text-accent">{children}</p>;
}
