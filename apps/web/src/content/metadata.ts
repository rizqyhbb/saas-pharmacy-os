import type { Metadata, Viewport } from "next";
import { COPY, type Lang } from "./copy";

export function metadataFor(lang: Lang): Metadata {
  const { meta } = COPY[lang];
  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: lang === "id" ? "/" : "/en",
      languages: { id: "/", en: "/en" },
    },
    openGraph: { title: meta.title, description: meta.description, locale: lang === "id" ? "id_ID" : "en_US" },
  };
}

/** The frontstore is always light (DESIGN.md, "Theme"), including the browser chrome. */
export const VIEWPORT: Viewport = { colorScheme: "light", themeColor: "#f4f6f5" };
