import type { Copy } from "@/content/copy";
import { DemoLoader } from "@/demo/DemoLoader";
import { Reveal } from "./Reveal";
import { Container, Eyebrow } from "./ui";

export function DemoSection({ copy }: { copy: Copy }) {
  const { demo } = copy;
  return (
    <section
      id="demo"
      className="border-y border-line bg-[color-mix(in_oklab,var(--surface-sunk)_55%,var(--bg))] py-[72px] md:py-24"
    >
      <Container>
        <Reveal className="mb-7 max-w-[640px] md:mb-10">
          <Eyebrow>{demo.eyebrow}</Eyebrow>
          <h2 className="text-title text-balance">{demo.title}</h2>
          <p className="mt-4 text-lead text-pretty text-muted">{demo.sub}</p>
        </Reveal>
        <DemoLoader lang={copy.lang === "en" ? "en" : "id"} copy={copy.demoUi} loading={demo.loading} />
      </Container>
    </section>
  );
}
