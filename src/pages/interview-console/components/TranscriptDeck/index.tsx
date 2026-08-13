import { Check, Languages } from "lucide-react";
import type { ReactNode } from "react";
import type { TranscriptSegment } from "../../types";
import { RealtimeMode } from "../../types";
import "./style.css";

type TranscriptDeckProps = {
  segments: TranscriptSegment[];
  mode: RealtimeMode;
  controls: ReactNode;
  selectedSegmentId?: string;
  selectedQuestionId?: string;
  onSelect: (itemId: string, questionId?: string) => void;
};

/** Renders finalized and tentative interviewer turns as a readable live transcript. */
export function TranscriptDeck({
  controls,
  mode,
  segments,
  selectedQuestionId,
  selectedSegmentId,
  onSelect,
}: TranscriptDeckProps) {
  const visibleSegments = segments.slice().reverse();
  return (
    <section className="transcript-deck" aria-label="面试官实时转写">
      <div className="panel-heading">
        <div className="transcript-heading-top">
          <div>
            <span className="panel-kicker">01 / LIVE TRANSCRIPT</span>
            <h2>面试官正在问什么</h2>
          </div>
        </div>
        {controls}
      </div>

      <div className="transcript-list" aria-live="polite">
        {visibleSegments.length === 0 ? (
          <div className="transcript-empty">
            <div className="sound-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>
              {mode === RealtimeMode.Translation
                ? "等待系统音频中的英文问题"
                : "等待系统音频中的语音"}
            </p>
            <small>
              {mode === RealtimeMode.Translation
                ? "英文识别后生成中文同传"
                : "只识别原始语音，不调用翻译模型"}
            </small>
          </div>
        ) : (
          visibleSegments.map((segment) => (
            <div
              className={`transcript-turn${
                segment.itemId === selectedSegmentId ? " is-current" : ""
              }${segment.mode === RealtimeMode.Transcription ? " is-transcription" : ""}`}
              key={segment.itemId}
            >
              <div className="turn-index">
                {String(segments.findIndex((value) => value.itemId === segment.itemId) + 1).padStart(
                  2,
                  "0",
                )}
              </div>
              <div className="turn-copy">
                <div className="turn-language">
                  <span>
                    {segment.mode === RealtimeMode.Translation
                      ? "EN / INTERVIEWER"
                      : "ASR / INTERVIEWER"}
                  </span>
                  {segment.isSourceFinal && <Check size={13} />}
                </div>
                <p className="source-text">
                  <span
                    aria-pressed={segment.itemId === selectedSegmentId}
                    onClick={() => onSelect(segment.itemId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(segment.itemId);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {segment.sourceText || <span className="text-placeholder">Listening…</span>}
                  </span>
                </p>
                {segment.mode === RealtimeMode.Translation && (
                  <div className="translation-line">
                    <Languages size={14} />
                    <p>
                      {segment.translatedText || (
                        <span className="text-placeholder">正在生成中文同传…</span>
                      )}
                    </p>
                  </div>
                )}
                <div className="turn-questions" aria-label="拆分后的面试问题">
                  {segment.questions.length > 0 ? (
                    segment.questions.map((question, index) => (
                      <button
                        aria-pressed={question.id === selectedQuestionId}
                        className={question.id === selectedQuestionId ? "is-active" : ""}
                        key={question.id}
                        onClick={() => onSelect(segment.itemId, question.id)}
                        title={question.text}
                        type="button"
                      >
                        <span>Q{index + 1}</span>
                        <strong>{question.text}</strong>
                        <i className={question.isFinal ? "is-final" : ""} />
                      </button>
                    ))
                  ) : segment.sourceText ? (
                    <span className="questions-pending">正在拆分问题…</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
