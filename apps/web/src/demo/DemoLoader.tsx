"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { panelClass } from "@apotek/ui";
import type { Copy, Lang } from "@/content/copy";

const Demo = lazy(() => import("./Demo"));

/**
 * The demo reads the visitor's local date and holds client state, so it only
 * renders in the browser. Until then a skeleton holds its layout (no CLS).
 */
export function DemoLoader({ lang, copy, loading }: { lang: Lang; copy: Copy["demoUi"]; loading: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const skeleton = <DemoSkeleton label={loading} />;
  if (!mounted) return skeleton;
  return (
    <Suspense fallback={skeleton}>
      <Demo lang={lang} copy={copy} />
    </Suspense>
  );
}

function DemoSkeleton({ label }: { label: string }) {
  const bar = "rounded-md bg-sunk motion-safe:animate-pulse";
  return (
    <div role="status" aria-label={label} className={`${panelClass({ raised: true })} overflow-hidden`}>
      <div className="border-b border-line bg-accent-soft/45 px-5 py-5 md:px-7">
        <div className={`${bar} h-1.5 w-40`} />
        <div className={`${bar} mt-4 h-4 w-56`} />
        <div className={`${bar} mt-2.5 h-3.5 w-4/5 max-w-[34rem]`} />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-h-[30rem] p-5 md:p-7">
          <div className={`${bar} h-4 w-20`} />
          <div className="mt-6 grid gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${bar} h-12`} />
            ))}
          </div>
          <p className="mt-8 text-[0.9rem] text-muted">{label}</p>
        </div>
        <div className="border-t border-line p-5 md:p-7 lg:border-l lg:border-t-0">
          <div className={`${bar} h-9 w-72 max-w-full`} />
          <div className="mt-6 grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${bar} h-11`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
