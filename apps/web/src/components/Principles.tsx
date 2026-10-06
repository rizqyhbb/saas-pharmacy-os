import Image from "next/image";
import type { Copy } from "@/content/copy";
import bottlesBlur from "@/assets/photos/bottles-blur.jpg";
import { Reveal } from "./Reveal";
import { Container } from "./ui";

/** Quiet typographic 2x2 over a faint photo band. */
export function Principles({ copy }: { copy: Copy }) {
  const { principles } = copy;
  return (
    <section className="relative isolate overflow-hidden py-20 md:py-28">
      <Image
        src={bottlesBlur}
        alt=""
        fill
        sizes="100vw"
        className="-z-10 object-cover object-[center_60%] opacity-[0.22]"
      />
      <Container>
        <Reveal>
          <h2 className="max-w-[15em] text-title text-balance md:text-[clamp(2rem,1.2rem+2.2vw,2.9rem)]">
            {principles.title}
          </h2>
        </Reveal>
        <div className="mt-10 grid max-w-[1040px] gap-8 md:mt-14 md:grid-cols-2 md:gap-x-20 md:gap-y-12">
          {principles.items.map((item) => (
            <Reveal key={item.title} className="border-t-[1.5px] border-ink/80 pt-5">
              <h3 className="text-[1.15rem] font-semibold tracking-[-0.01em]">{item.title}</h3>
              <p className="mt-2 max-w-[48ch] text-muted">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
