import { describe, expect, it } from "vitest";
import { contentProblem, firstName, personalize, toContent } from "@/lib/broadcast-message";

describe("firstName", () => {
  it.each([
    ["Dhruv Aagiwal", "Dhruv"],
    ["manvendra singh", "Manvendra"],
    ["VIKRANT SOOD | BHARAT 🇮🇳", "Vikrant"],
    ["𝑩𝒉𝒖𝒎𝒊 | Nail Tech", "Bhumi"],
    ["अमित शर्मा", "अमित"],
    ["hiker.bisht_", "there"],
    ["travelwithmehvish", "there"],
    ["parul_sharma31", "there"],
    ["Travel with Raghav 🏔️", "there"],
    ["Instagram User", "there"],
    ["G&G Sisters", "there"],
    ["🖤", "there"],
    [null, "there"],
  ])("%s -> %s", (name, want) => expect(firstName(name)).toBe(want));
});

describe("personalize", () => {
  it("fills every variable", () => {
    expect(personalize("Hi {{first_name}} ({{name}}), {{first_name}}!", "Dhruv Aagiwal")).toBe("Hi Dhruv (Dhruv Aagiwal), Dhruv!");
    expect(personalize("Hi {{first_name}} {{name}}", "a_b")).toBe("Hi there there");
  });
  it("leaves dollar patterns alone", () => expect(personalize("{{first_name}} $& $1", "Asha Rao")).toBe("Asha $& $1"));
});

describe("contentProblem", () => {
  it("accepts plain text and a full button", () => {
    expect(contentProblem({ text: "hi" })).toBeNull();
    expect(contentProblem({ text: "hi", buttonLabel: "Open", buttonUrl: "https://kaafila.club/x" })).toBeNull();
  });
  it.each([
    [{ text: "  " }, /Write/],
    [{ text: "x".repeat(1001) }, /1000/],
    [{ text: "x".repeat(641), buttonLabel: "a", buttonUrl: "https://a.b" }, /640/],
    [{ text: "Hi {{nmae}}" }, /nmae/],
    [{ text: "hi", buttonUrl: "https://a.b" }, /label/],
    [{ text: "hi", buttonLabel: "x".repeat(21), buttonUrl: "https://a.b" }, /20/],
    [{ text: "hi", buttonLabel: "a", buttonUrl: "http://a.b" }, /https/],
    [{ text: "hi", buttonLabel: "a", buttonUrl: "javascript:alert(1)" }, /https/],
  ])("%o", (content, want) => expect(contentProblem(content)).toMatch(want));
});

it("reads older and broken stored messages", () => {
  expect(toContent({ text: " hi " })).toEqual({ text: "hi" });
  expect(toContent(null)).toEqual({ text: "" });
  expect(toContent({ text: 5, buttonLabel: "x" })).toEqual({ text: "", buttonLabel: "x", buttonUrl: "" });
});
