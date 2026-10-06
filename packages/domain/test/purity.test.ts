import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ARCHITECTURE.md §3: packages/domain has no I/O imports. Only relative imports
// are allowed in src/, and nothing may read the clock or randomness.
test("domain source imports nothing outside itself and reads no clock", () => {
  const srcDir = join(import.meta.dir, "../src");
  for (const file of readdirSync(srcDir)) {
    const source = readFileSync(join(srcDir, file), "utf8");
    for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
      expect({ file, specifier }).toEqual({ file, specifier: expect.stringMatching(/^\.\//) });
    }
    expect({ file, clock: /Date\.now|new Date\(\)|Math\.random/.test(source) }).toEqual({ file, clock: false });
  }
});
