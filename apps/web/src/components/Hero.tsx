import Image from "next/image";
import { buttonClass } from "@apotek/ui";
import type { Copy } from "@/content/copy";
import pharmacistShelf from "@/assets/photos/pharmacist-shelf.jpg";
import { StockPreview } from "./StockPreview";
import { Container, stagger } from "./ui";

/** Asymmetric split: promise on the left, a real pharmacy with a live stock card on the right. */
export function Hero({ copy }: { copy: Copy }) {
  const { hero } = copy;
  return (
    <section id="top" className="pb-10 pt-7 md:pb-14 md:pt-10">
      <Container className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:gap-[72px]">
        <div>
          <h1 className="enter text-display text-balance" style={stagger(0)}>
            {hero.title}
          </h1>
          <p className="enter mt-5 max-w-[34em] text-lead text-pretty text-muted md:mt-6" style={stagger(1)}>
            {hero.sub}
          </p>
          <div className="enter mt-7 flex flex-wrap gap-3 md:mt-9" style={stagger(2)}>
            <a className={`${buttonClass()} flex-1 sm:flex-none`} href="#demo">
              {hero.primary}
            </a>
            <a className={`${buttonClass({ variant: "secondary" })} flex-1 sm:flex-none`} href="#pilot">
              {hero.secondary}
            </a>
          </div>
        </div>
        <div className="enter relative md:pb-[88px]" style={stagger(3)}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-panel bg-sunk md:aspect-auto md:h-[480px] lg:h-[clamp(380px,calc(100svh-270px),620px)]">
            <Image
              src={pharmacistShelf}
              alt={hero.photoAlt}
              fill
              preload
              sizes="(min-width: 1024px) 560px, 100vw"
              placeholder="blur"
              className="object-cover object-[46%_40%]"
            />
          </div>
          <div className="relative mx-3 -mt-14 md:absolute md:bottom-0 md:left-6 md:mx-0 md:mt-0 md:w-[min(410px,76%)] lg:-left-11">
            <StockPreview copy={copy.stockPreview} />
          </div>
        </div>
      </Container>
    </section>
  );
}
