import { BookOpenText, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  KnowledgeDocument,
  KnowledgeRefreshResult,
  KnowledgeStats,
} from "../../types";
import "./style.css";

type KnowledgeOverviewProps = {
  expectedCount: number;
  onStatsChange: (stats: KnowledgeStats) => void;
};

/** Loads every complete knowledge entry for the overview tab. */
async function fetchKnowledgeDocuments() {
  const response = await fetch("/api/knowledge");
  const body = (await response.json()) as {
    results?: KnowledgeDocument[];
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || "知识库读取失败。");
  }
  return body.results ?? [];
}

/** Requests an incremental directory scan and returns its indexing summary. */
async function refreshKnowledgeIndex() {
  const response = await fetch("/api/knowledge/refresh", { method: "POST" });
  const body = (await response.json()) as Partial<KnowledgeRefreshResult> & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || "知识库更新失败。");
  }
  return body as KnowledgeRefreshResult;
}

/** Formats the incremental work so unchanged documents are visible to the user. */
function formatRefreshResult(result: KnowledgeRefreshResult) {
  if (result.added + result.updated + result.deleted === 0) {
    return `没有变化，已跳过 ${result.unchanged} 条知识，未调用 embedding`;
  }
  return [
    `新增 ${result.added}`,
    `更新 ${result.updated}`,
    `删除 ${result.deleted}`,
    `跳过 ${result.unchanged}`,
    `embedding ${result.embedded}`,
  ].join(" · ");
}

/** Presents the complete knowledge catalog without changing document granularity. */
export function KnowledgeOverview({ expectedCount, onStatsChange }: KnowledgeOverviewProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshErrorMessage, setRefreshErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    void fetchKnowledgeDocuments()
      .then(setDocuments)
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "知识库读取失败。");
      })
      .finally(() => setIsLoading(false));
  }, []);

  /** Refreshes only changed files, then reloads the visible catalog and readiness counts. */
  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshMessage("");
    setRefreshErrorMessage("");
    try {
      const result = await refreshKnowledgeIndex();
      const knowledgeDocuments = await fetchKnowledgeDocuments();
      setDocuments(knowledgeDocuments);
      onStatsChange(result.stats);
      setRefreshMessage(formatRefreshResult(result));
    } catch (error) {
      setRefreshErrorMessage(error instanceof Error ? error.message : "知识库更新失败。");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="knowledge-overview" aria-label="知识库总览" role="tabpanel">
      <div className="overview-heading">
        <div>
          <span className="panel-kicker">02 / KNOWLEDGE LIBRARY</span>
          <h2>全部知识</h2>
        </div>
        <div className="overview-heading-actions">
          <p>
            <BookOpenText size={12} />
            {documents.length || expectedCount} 条完整知识 · 卡片内可上下滚动
          </p>
          <button
            aria-label="增量更新知识库"
            disabled={isRefreshing}
            onClick={() => void handleRefresh()}
            type="button"
          >
            <RefreshCw className={isRefreshing ? "is-spinning" : ""} size={12} />
            {isRefreshing ? "更新中" : "更新知识"}
          </button>
        </div>
      </div>

      {(refreshMessage || refreshErrorMessage) && (
        <p
          aria-live="polite"
          className={`overview-refresh-message${refreshErrorMessage ? " is-error" : ""}`}
        >
          {refreshErrorMessage || refreshMessage}
        </p>
      )}

      {isLoading ? (
        <div className="overview-state">
          <LoaderCircle className="is-spinning" size={22} />
          正在读取完整知识库
        </div>
      ) : errorMessage ? (
        <div className="overview-state is-error">{errorMessage}</div>
      ) : (
        <div className="overview-grid">
          {documents.map((document, index) => (
            <article className="overview-card" key={document.id}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <p>
                    <FileText size={10} />
                    {document.sourceName.replace(/-英文版本|\.md/g, "")}
                  </p>
                  <h3>{document.heading}</h3>
                </div>
              </header>
              <div className="overview-content">
                <p>{document.content}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
