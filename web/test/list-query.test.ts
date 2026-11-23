import { describe, expect, it } from "vitest";
import { addPage, describeList, readListQuery, toSearch } from "../lib/customers";

const dana = { id: "1", name: "Dana Whitfield", email: "dana@example.com", phone: null, status: "lead" as const };
const liam = { id: "2", name: "Liam Ortiz", email: "liam.ortiz@example.com", phone: null, status: "active" as const };
const priya = { id: "3", name: "Priya Nair", email: "priya@example.com", phone: null, status: "active" as const };

describe("the list's address", () => {
  it("is empty for the whole list", () => {
    expect(toSearch({ q: "", status: null })).toBe("");
    expect(toSearch({ q: "   ", status: null })).toBe("");
  });

  it("carries the search and the status, and the cursor only when asked", () => {
    expect(toSearch({ q: "dana", status: null })).toBe("?q=dana");
    expect(toSearch({ q: "", status: "active" })).toBe("?status=active");
    expect(toSearch({ q: " Dana W ", status: "lead" })).toBe("?q=Dana+W&status=lead");
    expect(toSearch({ q: "dana", status: null, cursor: "abc=" })).toBe("?q=dana&cursor=abc%3D");
  });

  it("escapes what was typed", () => {
    expect(toSearch({ q: "a&status=active", status: null })).toBe("?q=a%26status%3Dactive");
  });

  it("is read back the same way", () => {
    expect(readListQuery("?q=Dana+W&status=lead")).toEqual({ q: "Dana W", status: "lead" });
    expect(readListQuery("")).toEqual({ q: "", status: null });
  });

  it("drops a status that does not exist and anything else in the address", () => {
    expect(readListQuery("?status=archived&cursor=abc&utm_source=x")).toEqual({ q: "", status: null });
  });
});

describe("adding a page to the list", () => {
  it("puts the new customers after the ones already shown", () => {
    expect(addPage([dana], [liam, priya])).toEqual([dana, liam, priya]);
  });

  it("does not show a customer twice when one is already on screen", () => {
    expect(addPage([liam, dana], [liam, priya])).toEqual([liam, dana, priya]);
  });
});

describe("the line under the heading", () => {
  const all = { q: "", status: null };

  it("counts the customers when every one of them is on screen", () => {
    expect(describeList(3, false, all)).toBe("3 customers in Portland");
    expect(describeList(1, false, all)).toBe("1 customer in Portland");
  });

  it("does not claim a total while there are more to load, because HyphaBase gives none", () => {
    expect(describeList(25, true, all)).toBe("Showing 25 customers, newest first");
    expect(describeList(50, true, { q: "an", status: null })).toBe("Showing 50 matches, newest first");
  });

  it("counts the matches of a search or a status", () => {
    expect(describeList(7, false, { q: "dan", status: null })).toBe("7 customers match");
    expect(describeList(1, false, { q: "", status: "active" })).toBe("1 customer matches");
    expect(describeList(0, false, { q: "zzz", status: null })).toBe("No customers match");
  });
});
