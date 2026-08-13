import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealtimeMode } from "../../types";
import { TranscriptDeck } from "./index";

describe("TranscriptDeck", () => {
  it("renders translated turns in a selectable non-button container", () => {
    const html = renderToStaticMarkup(
      <TranscriptDeck
        controls={<div />}
        mode={RealtimeMode.Translation}
        onSelect={() => undefined}
        segments={[
          {
            itemId: "turn-1",
            mode: RealtimeMode.Translation,
            sourceText: "How did you reduce false positives?",
            translatedText: "你是如何减少误报的？",
            isSourceFinal: true,
            isTranslationFinal: true,
            questions: [
              {
                id: "turn-1_q1",
                text: "How did you reduce false positive alerts?",
                isFinal: true,
                knowledgeResults: [],
              },
              {
                id: "turn-1_q2",
                text: "What impact did reducing false positives have?",
                isFinal: true,
                knowledgeResults: [],
              },
            ],
            createdAt: 1,
          },
        ]}
        selectedQuestionId="turn-1_q1"
        selectedSegmentId="turn-1"
      />,
    );

    expect(html).toContain('class="transcript-turn is-current"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("How did you reduce false positive alerts?");
    expect(html).toContain("What impact did reducing false positives have?");
    expect(html).toContain("Q1");
    expect(html).toContain("Q2");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("你是如何减少误报的？");
    expect(html).not.toMatch(/<button[^>]*class="transcript-turn/);
  });
});
