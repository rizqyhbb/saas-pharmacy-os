import { Chip } from "@apotek/ui";
import type { Copy } from "@/content/copy";
import { Reveal } from "./Reveal";
import { Container } from "./ui";

/** Sticky heading beside a vertical timeline. Only the stage being built is filled. */
export function Roadmap({ copy }: { copy: Copy }) {
  const { roadmap } = copy;
  return (
    <section id="roadmap" className="border-t border-line py-20 md:pb-24 md:pt-28">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <Reveal className="lg:sticky lg:top-[108px]">
          <h2 className="text-title text-balance">{roadmap.title}</h2>
        </Reveal>
        <ol className="relative before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-0.5 before:bg-line">
          {roadmap.stages.map((stage, i) => {
            const current = i === 0;
            return (
              <li key={stage.title} className="reveal relative pb-10 pl-10 last:pb-0 md:pb-[52px] md:pl-12">
                {current && (
                  <span
                    aria-hidden
                    className="absolute left-[9px] top-6 h-[calc(100%-12px)] w-0.5 bg-gradient-to-b from-accent to-line"
                  />
                )}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1 size-5 rounded-full border-2 ${
                    current ? "border-accent bg-accent shadow-[0_0_0_5px_var(--accent-soft)]" : "border-line bg-bg"
                  }`}
                />
                <Chip tone={current ? "next" : "outline"}>{stage.label}</Chip>
                <h3 className="mt-3 text-[1.4rem] font-semibold tracking-[-0.02em]">{stage.title}</h3>
                <ul className="mt-3.5 grid gap-2">
                  {stage.items.map((entry) => (
                    <li
                      key={entry}
                      className="relative max-w-[54ch] pl-[18px] text-muted before:absolute before:left-0 before:top-[0.8em] before:h-[1.5px] before:w-2 before:bg-muted/70"
                    >
                      {entry}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
