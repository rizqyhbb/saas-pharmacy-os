import { Wordmark } from "@apotek/ui";
import { PRODUCT_NAME, type Copy } from "@/content/copy";
import { Container } from "./ui";

export function Footer({ copy }: { copy: Copy }) {
  const other = copy.lang === "id" ? "en" : "id";
  return (
    <footer className="border-t border-line pb-11 pt-9">
      <Container className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
          <a href="#top" aria-label={copy.nav.home} className="rounded-control">
            <Wordmark name={PRODUCT_NAME} />
          </a>
          <span className="text-[0.94rem] text-muted">{copy.footer.tagline}</span>
        </div>
        <div className="flex items-center gap-5 text-[0.9rem] text-muted">
          <span>{copy.footer.rights}</span>
          <a className="hover:text-ink" href={copy.nav.switchHref} hrefLang={other} lang={other}>
            {copy.nav.switchLabel}
          </a>
        </div>
      </Container>
    </footer>
  );
}
