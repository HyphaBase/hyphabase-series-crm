import { describe, expect, it } from "vitest";
import { addPage, describeList, readListQuery, toSearch } from "../lib/customers";

const dana = { id: "1", first_name: "Dana", last_name: "Whitfield", name: "Dana Whitfield", email: "dana@example.com", phone: "555-0101", status: "lead" as const };
const liam = { id: "2", first_name: "Liam", last_name: "Ortiz", name: "Liam Ortiz", email: "liam.ortiz@example.com", phone: "555-0102", status: "active" as const };
const priya = { id: "3", first_name: "Priya", last_name: "Nair", name: "Priya Nair", email: "priya@example.com", phone: "555-0103", status: "active" as const };

describe("the list's address", () => {
  it("is empty for the whole list", () => {
    expect(toSearch({ q: "", status: null })).toBe("");
    expect(toSearch({ q: "   ", status: null })).toBe("");
  });

  it("carries the search and the status, and the page only when asked", () => {
    expect(toSearch({ q: "dana", status: null })).toBe("?q=dana");
    expect(toSearch({ q: "", status: "active" })).toBe("?status=active");
    expect(toSearch({ q: " Dana W ", status: "lead" })).toBe("?q=Dana+W&status=lead");
    expect(toSearch({ q: "dana", status: null, page: 2 })).toBe("?q=dana&page=2");
    expect(toSearch({ q: "dana", status: null, page: null })).toBe("?q=dana");
  });

  it("escapes what was typed", () => {
    expect(toSearch({ q: "a&status=active", status: null })).toBe("?q=a%26status%3Dactive");
  });

  it("is read back the same way", () => {
    expect(readListQuery("?q=Dana+W&status=lead")).toEqual({ q: "Dana W", status: "lead" });
    expect(readListQuery("")).toEqual({ q: "", status: null });
  });

  it("drops a status that does not exist and anything else in the address", () => {
    expect(readListQuery("?status=archived&page=3&utm_source=x")).toEqual({ q: "", status: null });
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
    expect(describeList(3, 3, all)).toBe("3 customers in Portland");
    expect(describeList(1, 1, all)).toBe("1 customer in Portland");
  });

  it("says how many there are in all while there are more to load: the Clients module returns a total", () => {
    expect(describeList(25, 63, all)).toBe("Showing 25 of 63 customers, newest first");
    expect(describeList(50, 58, { q: "an", status: null })).toBe("Showing 50 of 58 matches, newest first");
  });

  it("counts the matches of a search or a status", () => {
    expect(describeList(7, 7, { q: "dan", status: null })).toBe("7 customers match");
    expect(describeList(1, 1, { q: "", status: "active" })).toBe("1 customer matches");
    expect(describeList(0, 0, { q: "zzz", status: null })).toBe("No customers match");
  });
});
