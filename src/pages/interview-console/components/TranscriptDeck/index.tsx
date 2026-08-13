import { AudioLines, Check, Languages } from "lucide-react";
import type { TranscriptSegment } from "../../types";
import { RealtimeMode } from "../../types";
import "./style.css";

type TranscriptDeckProps = {
  segments: TranscriptSegment[];
  mode: RealtimeMode;
  selectedSegmentId?: string;
  onSelect: (itemId: string) => void;
};

/** Renders finalized and tentative interviewer turns as a readable live transcript. */
export function TranscriptDeck({ mode, segments, selectedSegmentId, onSelect }: TranscriptDeckProps) {
  const visibleSegments = segments.slice().reverse();
  return (
    <section className="transcript-deck" aria-label="面试官实时转写">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">01 / LIVE TRANSCRIPT</span>
          <h2>面试官正在问什么</h2>
        </div>
        <div className="transcript-mode-label">
          <span>{mode === RealtimeMode.Translation ? "翻译模式" : "普通模式"}</span>
          <AudioLines size={22} strokeWidth={1.5} />
        </div>
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
            <button
              aria-pressed={segment.itemId === selectedSegmentId}
              className={`transcript-turn${
                segment.itemId === selectedSegmentId ? " is-current" : ""
              }${segment.mode === RealtimeMode.Transcription ? " is-transcription" : ""}`}
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
                  <span>
                    {segment.mode === RealtimeMode.Translation
                      ? "EN / INTERVIEWER"
                      : "ASR / INTERVIEWER"}
                  </span>
                  {segment.isSourceFinal && <Check size={13} />}
                </div>
                <p className="source-text">
                  {segment.sourceText || <span className="text-placeholder">Listening…</span>}
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
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
