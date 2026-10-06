import { COPY, type Lang } from "@/content/copy";
import { DemoSection } from "./DemoSection";
import { Features } from "./Features";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { Nav } from "./Nav";
import { Pilot } from "./Pilot";
import { Principles } from "./Principles";
import { Problem } from "./Problem";
import { Roadmap } from "./Roadmap";

export function Landing({ lang }: { lang: Lang }) {
  const copy = COPY[lang];
  return (
    <>
      <Nav copy={copy} />
      <main>
        <Hero copy={copy} />
        <Problem copy={copy} />
        <DemoSection copy={copy} />
        <Features copy={copy} />
        <Principles copy={copy} />
        <Roadmap copy={copy} />
        <Pilot copy={copy} />
      </main>
      <Footer copy={copy} />
    </>
  );
}
