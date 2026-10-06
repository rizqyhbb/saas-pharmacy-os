import type { ReactNode } from "react";
import { RootShell } from "@/components/RootShell";
import { metadataFor, VIEWPORT } from "@/content/metadata";

export const metadata = metadataFor("en");
export const viewport = VIEWPORT;

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>;
}
