import { AudioLines, Check, Languages } from "lucide-react";
import type { TranscriptSegment } from "../../types";
import "./style.css";

type TranscriptDeckProps = {
  segments: TranscriptSegment[];
  selectedSegmentId?: string;
  onSelect: (itemId: string) => void;
};

/** Renders finalized and tentative interviewer turns as a readable live transcript. */
export function TranscriptDeck({ segments, selectedSegmentId, onSelect }: TranscriptDeckProps) {
  const visibleSegments = segments.slice().reverse();
  return (
    <section className="transcript-deck" aria-label="面试官实时转写">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">01 / LIVE TRANSCRIPT</span>
          <h2>面试官正在问什么</h2>
        </div>
        <AudioLines size={22} strokeWidth={1.5} />
      </div>

      <div className="transcript-list" aria-live="polite">
        {visibleSegments.length === 0 ? (
          <div className="transcript-empty">
            <div className="sound-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>等待系统音频中的英文问题</p>
            <small>这里不会请求或读取麦克风</small>
          </div>
        ) : (
          visibleSegments.map((segment) => (
            <button
              aria-pressed={segment.itemId === selectedSegmentId}
              className={`transcript-turn ${
                segment.itemId === selectedSegmentId ? "is-current" : ""
              }`}
              key={segment.itemId}
              onClick={() => onSelect(segment.itemId)}
              type="button"
            >
              <div className="turn-index">
                {String(segments.findIndex((value) => value.itemId === segment.itemId) + 1).padStart(
                  2,
                  "0",
                )}
              </div>
              <div className="turn-copy">
                <div className="turn-language">
                  <span>EN / INTERVIEWER</span>
                  {segment.isSourceFinal && <Check size={13} />}
                </div>
                <p className="source-text">
                  {segment.sourceText || <span className="text-placeholder">Listening…</span>}
                </p>
                <div className="translation-line">
                  <Languages size={14} />
                  <p>
                    {segment.translatedText || (
                      <span className="text-placeholder">正在生成中文同传…</span>
                    )}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
