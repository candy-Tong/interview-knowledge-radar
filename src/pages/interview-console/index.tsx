import { BookOpenText, Database, Headphones, MessagesSquare, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ControlDock } from "./components/ControlDock";
import { KnowledgeOverview } from "./components/KnowledgeOverview";
import { KnowledgeRadar } from "./components/KnowledgeRadar";
import { TranscriptDeck } from "./components/TranscriptDeck";
import { useInterviewSession } from "./hooks/use-interview-session";
import { ConsoleView, type KnowledgeStats, type ServiceHealth } from "./types";
import "./style.css";

/** Fetches operational readiness without blocking the main interview workspace. */
async function fetchReadiness() {
  const [healthResponse, statsResponse] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/knowledge/stats"),
  ]);
  const health = (await healthResponse.json()) as ServiceHealth;
  const stats = statsResponse.ok
    ? ((await statsResponse.json()) as KnowledgeStats)
    : { documents: 0, chunks: 0, vectors: 0 };
  return { health, stats };
}

/** Explains the first unmet prerequisite before system-audio permission is requested. */
function getReadinessMessage(
  health: ServiceHealth | null,
  stats: KnowledgeStats,
) {
  if (!health) {
    return "正在检查本地服务配置";
  }
  if (!health.databaseReady) {
    return "PostgreSQL 未就绪，请先启动数据库并初始化表结构";
  }
  if (!health.dashScopeReady) {
    return "请先在 .env 配置阿里云 API Key 和 Workspace ID";
  }
  if (stats.chunks === 0) {
    return "知识库为空，请先执行 npm run db:ingest";
  }
  if (stats.vectors !== stats.chunks) {
    return `知识向量未完成：${stats.vectors}/${stats.chunks}，请执行 npm run db:ingest`;
  }
  return "只采集你主动共享的电脑音频";
}

/** Main single-screen workspace for live interpretation and retrieval evidence. */
export function InterviewConsolePage() {
  const session = useInterviewSession();
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [stats, setStats] = useState<KnowledgeStats>({ documents: 0, chunks: 0, vectors: 0 });
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [activeView, setActiveView] = useState(ConsoleView.Interview);
  const hasCompleteVectorIndex = stats.chunks > 0 && stats.vectors === stats.chunks;
  const canStart = Boolean(
    health?.databaseReady && health.dashScopeReady && hasCompleteVectorIndex,
  );

  useEffect(() => {
    void fetchReadiness()
      .then((result) => {
        setHealth(result.health);
        setStats(result.stats);
      })
      .catch(() => setHealth(null));
  }, []);

  const latestSegmentId = session.segments.at(-1)?.itemId;
  useEffect(() => {
    setSelectedSegmentId(latestSegmentId);
  }, [latestSegmentId]);

  const selectedSegment =
    session.segments.find((segment) => segment.itemId === selectedSegmentId) ??
    session.segments.at(-1);

  return (
    <main className="interview-console">
      <div className="grid-noise" aria-hidden="true" />
      <header className="console-header">
        <div className="brand-lockup">
          <span className="brand-mark">AG</span>
          <div>
            <p>ANSWER GRID</p>
            <h1>面试知识雷达</h1>
          </div>
        </div>
        <nav className="console-tabs" aria-label="页面视图" role="tablist">
          <button
            aria-selected={activeView === ConsoleView.Interview}
            className={activeView === ConsoleView.Interview ? "is-active" : ""}
            onClick={() => setActiveView(ConsoleView.Interview)}
            role="tab"
            type="button"
          >
            <MessagesSquare size={12} />
            面试辅助
          </button>
          <button
            aria-selected={activeView === ConsoleView.Knowledge}
            className={activeView === ConsoleView.Knowledge ? "is-active" : ""}
            onClick={() => setActiveView(ConsoleView.Knowledge)}
            role="tab"
            type="button"
          >
            <BookOpenText size={12} />
            知识库总览
            <span>{stats.documents}</span>
          </button>
        </nav>
        <div className="header-actions">
          <div className="readiness-strip" aria-label="服务状态">
            <div className={health?.dashScopeReady ? "is-ready" : ""} title="阿里云同传">
              <Headphones size={13} />
              <i />
            </div>
            <div className={health?.databaseReady ? "is-ready" : ""} title="PostgreSQL">
              <Database size={13} />
              <i />
            </div>
            <div className={hasCompleteVectorIndex ? "is-ready" : ""} title="本地 RAG">
              <ShieldCheck size={13} />
              <i />
            </div>
          </div>
          <ControlDock
            audioSourceLabel={session.audioSourceLabel}
            canStart={canStart}
            errorMessage={session.errorMessage}
            onClear={session.clear}
            onStart={session.start}
            onStop={session.stop}
            phase={session.phase}
            readinessMessage={getReadinessMessage(health, stats)}
          />
        </div>
      </header>

      {activeView === ConsoleView.Interview ? (
        <div className="workspace-grid" role="tabpanel">
          <TranscriptDeck
            onSelect={setSelectedSegmentId}
            segments={session.segments}
            selectedSegmentId={selectedSegment?.itemId}
          />
          <KnowledgeRadar segment={selectedSegment} />
        </div>
      ) : (
        <KnowledgeOverview expectedCount={stats.documents} onStatsChange={setStats} />
      )}
    </main>
  );
}
