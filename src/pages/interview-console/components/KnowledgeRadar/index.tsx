import { useEffect, useRef } from "react";
import { BookMarked, LocateFixed, Sparkles } from "lucide-react";
import type { KnowledgeResult, TranscriptSegment } from "../../types";
import "./style.css";

type KnowledgeRadarProps = {
  segment?: TranscriptSegment;
};

const maximumVisibleResults = 2;

/** Formats compact relevance signals without pretending they are probabilities. */
function formatScore(value: number) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(value >= 10 ? 1 : 3);
}

/** Renders one complete knowledge entry with its computed focus sentence marked. */
function renderKnowledgeContent(result: KnowledgeResult) {
  const focusStart = Math.min(Math.max(result.focusStart, 0), result.content.length);
  const focusEnd = Math.min(Math.max(result.focusEnd, focusStart), result.content.length);

  if (focusEnd === focusStart) {
    return (
      <>
        <span className="knowledge-focus-anchor is-fallback" data-focus-anchor aria-hidden="true" />
        {result.content}
      </>
    );
  }

  return (
    <>
      {result.content.slice(0, focusStart)}
      <mark className="knowledge-focus-anchor" data-focus-anchor>
        {result.content.slice(focusStart, focusEnd)}
      </mark>
      {result.content.slice(focusEnd)}
    </>
  );
}

/** Shows the selected question's two knowledge entries and moves each one to its best passage. */
export function KnowledgeRadar({ segment }: KnowledgeRadarProps) {
  const radarRef = useRef<HTMLElement>(null);
  const results = (segment?.knowledgeResults ?? []).slice(0, maximumVisibleResults);
  const resultIdentity = results
    .map((result) => `${result.id}:${result.focusStart}:${result.focusEnd}`)
    .join("|");

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const scrollRegions = radarRef.current?.querySelectorAll<HTMLElement>(".knowledge-scroll");
      scrollRegions?.forEach((scrollRegion) => {
        const anchor = scrollRegion.querySelector<HTMLElement>("[data-focus-anchor]");
        if (!anchor) {
          return;
        }
        scrollRegion.scrollTo({
          top: Math.max(anchor.offsetTop - 56, 0),
          behavior: "smooth",
        });
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [resultIdentity, segment?.itemId]);

  return (
    <section className="knowledge-radar" aria-label="知识库检索结果" ref={radarRef}>
      {segment?.knowledgeError && <div className="knowledge-error">{segment.knowledgeError}</div>}

      <div className="knowledge-columns">
        {[0, 1].map((index) => {
          const result = results[index];
          if (!result) {
            return (
              <div className="knowledge-empty" key={index}>
                <Sparkles size={22} strokeWidth={1.2} />
                <p>{segment?.sourceText ? "正在根据当前语音检索…" : "等待对应知识"}</p>
              </div>
            );
          }
          return (
            <article className="knowledge-card" key={result.id}>
              <div className="knowledge-card-header">
                <span className="knowledge-rank">KNOWLEDGE {String(index + 1).padStart(2, "0")}</span>
                <div className="knowledge-meta">
                  <span className="source-pill">
                    <BookMarked size={12} />
                    {result.sourceName.replace(/-英文版本|\.md/g, "")}
                  </span>
                  <span>BM25 {formatScore(result.bm25Score)}</span>
                  <span>VECTOR {formatScore(result.vectorScore)}</span>
                </div>
                <h3>{result.heading}</h3>
                <span className="knowledge-locate-hint">
                  <LocateFixed size={10} strokeWidth={1.8} />
                  已定位相关段落 · 可上下滚动查看全文
                </span>
              </div>
              <div className="knowledge-scroll">
                <p>{renderKnowledgeContent(result)}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
