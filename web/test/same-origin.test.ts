import { describe, expect, it } from "vitest";
import { sameOrigin } from "../lib/same-origin";

describe("same-origin check", () => {
  const request = (headers: Record<string, string>) => new Request("http://crm.test/api/customers", { method: "POST", headers });

  it("accepts a request from the app's own pages", () => {
    expect(sameOrigin(request({ host: "crm.test", origin: "http://crm.test" }))).toBe(true);
    expect(sameOrigin(request({ host: "localhost:3010", origin: "https://dev-crm.example", "x-forwarded-host": "dev-crm.example" }))).toBe(true);
  });

  it("accepts a request with no Origin header, such as curl", () => {
    expect(sameOrigin(request({ host: "crm.test" }))).toBe(true);
  });

  it("refuses a request from another site", () => {
    expect(sameOrigin(request({ host: "crm.test", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(request({ host: "crm.test", origin: "null" }))).toBe(false);
  });
});
