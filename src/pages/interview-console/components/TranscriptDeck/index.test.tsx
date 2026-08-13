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
            knowledgeResults: [],
            createdAt: 1,
          },
        ]}
        selectedSegmentId="turn-1"
      />,
    );

    expect(html).toContain('class="transcript-turn is-current"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("你是如何减少误报的？");
    expect(html).not.toMatch(/<button[^>]*class="transcript-turn/);
  });
});
