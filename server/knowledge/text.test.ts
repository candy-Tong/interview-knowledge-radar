import { describe, expect, it } from "vitest";
import {
  countTerms,
  locateRelevantPassage,
  prepareMarkdownDocument,
  tokenizeEnglish,
} from "./text.js";

describe("tokenizeEnglish", () => {
  it("removes stop words and normalizes common suffixes", () => {
    expect(tokenizeEnglish("How did you improve the shared pipelines and builds?"))
      .toEqual(["improve", "shar", "pipeline", "build"]);
  });

  it("keeps technical tokens useful for lexical retrieval", () => {
    expect(tokenizeEnglish("React TypeScript CI/CD and C++ quality gates"))
      .toEqual(["react", "typescript", "ci", "cd", "c++", "quality", "gate"]);
  });

  it("removes trailing periods from tokens", () => {
    expect(tokenizeEnglish("English. Time. Project. version-2.0."))
      .toEqual(["english", "time", "project", "version-2.0"]);
  });
});

describe("prepareMarkdownDocument", () => {
  it("keeps one source file as one complete knowledge entry", () => {
    const markdown = [
      "# Customer complaint Agent",
      "Why did you build it?",
      "We wanted earlier warning signals.",
      "Another question?",
      "A second answer.",
    ].join("\n\n");
    const document = prepareMarkdownDocument("complaints.md", markdown);

    expect(document?.heading).toBe("Customer complaint Agent");
    expect(document?.content).toContain("earlier warning signals");
    expect(document?.content).toContain("A second answer.");
  });

  it("uses the file name when the document has no heading", () => {
    const document = prepareMarkdownDocument("monorepo.md", "First answer.<br>Second answer.");

    expect(document).toEqual({
      heading: "monorepo",
      content: "First answer.\nSecond answer.",
    });
  });
});

describe("locateRelevantPassage", () => {
  it("locates the relevant sentence inside a complete document", () => {
    const content = [
      "The service receives many customer complaints every day.",
      "The image flow checks screenshots for blank pages.",
      "The on-call bot removes known false alerts before notifying people.",
      "The team reviews the remaining incidents.",
    ].join("\n\n");

    const passage = locateRelevantPassage(
      content,
      "How did you reduce false positive alerts in the customer complaint agent?",
    );

    expect(content.slice(passage.focusStart, passage.focusEnd))
      .toBe("The on-call bot removes known false alerts before notifying people.");
    expect(passage.focusStart).toBeGreaterThan(content.indexOf("image flow"));
  });

  it("keeps the document at the top when no lexical passage can be located", () => {
    expect(locateRelevantPassage("A short knowledge entry.", "why when how")).toEqual({
      focusStart: 0,
      focusEnd: 0,
    });
  });
});

describe("countTerms", () => {
  it("materializes term frequencies for BM25", () => {
    const result = countTerms("quality quality gates");
    expect(result.termFrequency.get("quality")).toBe(2);
    expect(result.termFrequency.get("gate")).toBe(1);
  });
});
