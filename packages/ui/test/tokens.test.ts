import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the design tokens every surface depends on:
 * - every colour token carries a light and a dark value (no half-themed screens),
 * - every Tailwind colour maps to a defined token,
 * - the text pairs we actually use pass WCAG AA (4.5:1) in both themes.
 */
const css = readFileSync(join(import.meta.dir, "../src/tokens.css"), "utf8");

function block(startMarker: string): string {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`missing ${startMarker}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unclosed ${startMarker}`);
}

function vars(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(match[1]!, match[2]!.trim());
  return out;
}

const tokens = vars(block(":root {\n  --bg"));
const theme = vars(block("@theme inline"));

// Built from other tokens or from a light-dark() inside, so not a plain pair.
const DERIVED = new Set(["--panel-shadow", "--control-shadow"]);
const PAIR = /^light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)$/i;

const light = new Map<string, string>();
const dark = new Map<string, string>();
for (const [name, value] of tokens) {
  const pair = PAIR.exec(value);
  if (pair) {
    light.set(name, pair[1]!);
    dark.set(name, pair[2]!);
  }
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [text, background] pairs used on real screens. */
const PAIRS: [string, string][] = [
  ["--ink", "--bg"],
  ["--ink", "--surface"],
  ["--ink", "--surface-sunk"],
  ["--muted", "--bg"],
  ["--muted", "--surface"],
  ["--muted", "--surface-sunk"],
  ["--accent", "--bg"],
  ["--accent", "--surface"],
  ["--accent-ink", "--accent"],
  ["--accent-soft-ink", "--accent-soft"],
  ["--ink", "--accent-soft"],
  ["--warn", "--warn-soft"],
  ["--danger", "--danger-soft"],
  ["--danger", "--surface"],
];

describe("design tokens", () => {
  test("every colour token is a light-dark() pair", () => {
    const unpaired = [...tokens.keys()].filter((name) => !DERIVED.has(name) && !light.has(name));
    expect(unpaired).toEqual([]);
  });

  test("every theme colour points at a defined token", () => {
    const broken = [...theme.entries()]
      .filter(([name]) => name.startsWith("--color-"))
      .filter(([, value]) => !tokens.has(value.replace(/^var\((--[a-z0-9-]+)\)$/, "$1")));
    expect(broken).toEqual([]);
  });

  for (const [mode, palette] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    test(`text pairs pass WCAG AA in ${mode} mode`, () => {
      const failing = PAIRS.map(([fg, bg]) => ({ fg, bg, ratio: contrast(palette.get(fg)!, palette.get(bg)!) }))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ fg, bg, ratio }) => `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      expect(failing).toEqual([]);
    });
  }
});
