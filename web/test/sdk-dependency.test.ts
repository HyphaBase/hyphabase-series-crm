import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const web = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(web, "package.json"), "utf8"));

describe("the HyphaBase SDK dependency", () => {
  it("comes from npm, not from a file in this repository", () => {
    expect(pkg.dependencies.hyphabase).toMatch(/^\^?\d+\.\d+\.\d+$/);
    expect(existsSync(path.join(web, "..", "vendor"))).toBe(false);
  });
});
