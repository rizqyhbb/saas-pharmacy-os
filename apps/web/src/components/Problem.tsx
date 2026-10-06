import { ArrowRight, CalendarX, DotsSix, Package, Pill, Prescription, Stack } from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import { panelClass } from "@apotek/ui";
import { fill, type Copy } from "@/content/copy";
import { Reveal } from "./Reveal";
import { Container } from "./ui";

const RUNGS: { icon: Icon; unit: string; tablets: number; contains?: { n: number; unit: string } }[] = [
  { icon: Package, unit: "Box", tablets: 100, contains: { n: 10, unit: "strip" } },
  { icon: DotsSix, unit: "Strip", tablets: 10, contains: { n: 10, unit: "tablet" } },
  { icon: Pill, unit: "Tablet", tablets: 1 },
];

const POINT_ICONS: Icon[] = [Stack, CalendarX, Prescription];

/** Statement and unit ladder side by side, then the three reasons as a ruled list. */
export function Problem({ copy }: { copy: Copy }) {
  const { problem } = copy;
  return (
    <section className="py-[72px] md:py-24 lg:pb-24 lg:pt-[104px]">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <Reveal>
            <h2 className="text-title text-balance">{problem.title}</h2>
            <p className="mt-[18px] max-w-[58ch] text-lead text-pretty text-muted">{problem.body}</p>
          </Reveal>
          <Reveal>
            <div
              role="img"
              aria-label={problem.ladderLabel}
              className={`${panelClass()} grid grid-cols-1 p-3.5 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:p-[22px]`}
            >
              {RUNGS.map((rung, i) => {
                const Glyph = rung.icon;
                const base = i === RUNGS.length - 1;
                return (
                  <div key={rung.unit} className="contents">
                    <div
                      className={`flex items-center gap-3.5 rounded-control px-[18px] py-4 md:flex-col md:items-start md:gap-1.5 ${
                        base ? "bg-accent-soft" : "bg-sunk"
                      }`}
                    >
                      <Glyph aria-hidden className="size-[30px] text-accent" />
                      <span className="font-semibold md:mt-1.5">{rung.unit}</span>
                      <span className="ml-auto font-mono text-[0.9rem] text-muted md:ml-0">
                        {fill(problem.tablets, { n: rung.tablets })}
                      </span>
                    </div>
                    {rung.contains && (
                      <div
                        aria-hidden
                        className="flex items-center justify-center gap-2 px-3.5 py-2.5 text-center text-[0.8rem] text-muted md:flex-col md:gap-1 md:py-0"
                      >
                        <ArrowRight className="size-5 rotate-90 text-ink md:rotate-0" />
                        <span>{fill(problem.contains, rung.contains)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
        <ul className="mt-12 border-t border-line md:mt-[72px]">
          {problem.points.map((point, i) => {
            const Glyph = POINT_ICONS[i]!;
            return (
              <li
                key={point.title}
                className="reveal grid gap-2 border-b border-line py-[22px] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-[26px]"
              >
                <h3 className="flex items-baseline gap-3 text-[1.15rem] font-semibold tracking-[-0.01em]">
                  <Glyph aria-hidden className="size-5 shrink-0 translate-y-[3px] text-accent" />
                  {point.title}
                </h3>
                <p className="max-w-[56ch] text-muted">{point.body}</p>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
