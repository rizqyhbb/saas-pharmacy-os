import type { ReactNode } from "react";

/**
 * Sections rise in as they scroll into view, so the page reads in order.
 * Pure CSS (scroll-driven animation, see `.reveal` in globals.css): content is
 * visible by default and only animates where the browser supports it and the
 * visitor allows motion. Nothing is hidden waiting for JavaScript.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`reveal ${className}`}>{children}</div>;
}
