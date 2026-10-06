import { buttonClass, Wordmark } from "@apotek/ui";
import { PRODUCT_NAME, type Copy } from "@/content/copy";
import { Container } from "./ui";

export function Nav({ copy }: { copy: Copy }) {
  const { nav } = copy;
  const link = "text-[0.95rem] text-muted transition-colors hover:text-ink";
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-line/70 bg-bg/85 backdrop-blur-md backdrop-saturate-150 md:h-[68px]">
      <Container className="flex h-full items-center gap-3 md:gap-8">
        <a href="#top" aria-label={nav.home} className="rounded-control">
          <Wordmark name={PRODUCT_NAME} />
        </a>
        <nav className="ml-auto hidden items-center gap-7 md:flex">
          <a className={link} href="#demo">
            {nav.demo}
          </a>
          <a className={link} href="#features">
            {nav.features}
          </a>
          <a className={link} href="#roadmap">
            {nav.roadmap}
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3.5 md:ml-0 md:gap-[18px]">
          <a
            className="rounded-control px-0.5 py-1.5 text-[0.88rem] font-medium text-muted transition-colors hover:text-ink"
            href={nav.switchHref}
            hrefLang={copy.lang === "id" ? "en" : "id"}
            lang={copy.lang === "id" ? "en" : "id"}
            aria-label={nav.switchLabel}
          >
            {nav.switchShort}
          </a>
          <a className={buttonClass({ size: "sm" })} href="#pilot">
            {nav.pilot}
          </a>
        </div>
      </Container>
    </header>
  );
}
