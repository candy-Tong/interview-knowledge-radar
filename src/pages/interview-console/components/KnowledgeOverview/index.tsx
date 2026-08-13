import {
  BookOpenText,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type {
  KnowledgeDocument,
  KnowledgeRefreshResult,
  KnowledgeResult,
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

/** Runs the same two-result hybrid retrieval used by live interviewer turns. */
async function searchKnowledgeDocuments(query: string) {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as {
    results?: KnowledgeResult[];
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || "知识库检索失败。");
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
  const [searchInput, setSearchInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeResult[]>([]);
  const [searchErrorMessage, setSearchErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

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
      if (submittedQuery) {
        setSearchResults(await searchKnowledgeDocuments(submittedQuery));
      }
      onStatsChange(result.stats);
      setRefreshMessage(formatRefreshResult(result));
    } catch (error) {
      setRefreshErrorMessage(error instanceof Error ? error.message : "知识库更新失败。");
    } finally {
      setIsRefreshing(false);
    }
  }

  /** Submits a representative interview question to the production retrieval path. */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      setSubmittedQuery("");
      setSearchResults([]);
      setSearchErrorMessage("");
      return;
    }
    if (query.length < 2) {
      setSearchErrorMessage("请输入至少两个字符的英文面试问题。");
      return;
    }

    setIsSearching(true);
    setSearchErrorMessage("");
    try {
      const results = await searchKnowledgeDocuments(query);
      setSearchResults(results);
      setSubmittedQuery(query);
    } catch (error) {
      setSearchErrorMessage(error instanceof Error ? error.message : "知识库检索失败。");
    } finally {
      setIsSearching(false);
    }
  }

  /** Restores the complete catalog after a simulated retrieval. */
  function handleClearSearch() {
    setSearchInput("");
    setSubmittedQuery("");
    setSearchResults([]);
    setSearchErrorMessage("");
  }

  const visibleDocuments = submittedQuery ? searchResults : documents;

  return (
    <section className="knowledge-overview" aria-label="知识库总览" role="tabpanel">
      <div className="overview-heading">
        <div>
          <span className="panel-kicker">02 / KNOWLEDGE LIBRARY</span>
          <h2>{submittedQuery ? "检索结果" : "全部知识"}</h2>
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

      <div className="overview-search-panel">
        <form className="overview-search-form" onSubmit={(event) => void handleSubmit(event)}>
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="模拟知识库检索"
            autoComplete="off"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="输入英文面试问题，模拟实时知识检索"
            type="search"
            value={searchInput}
          />
          {(searchInput || submittedQuery) && (
            <button
              aria-label="清空检索"
              className="overview-search-clear"
              onClick={handleClearSearch}
              type="button"
            >
              <X size={12} />
            </button>
          )}
          <button
            className="overview-search-submit"
            disabled={isLoading || isSearching}
            type="submit"
          >
            {isSearching ? <LoaderCircle className="is-spinning" size={12} /> : <Search size={12} />}
            {isSearching ? "搜索中" : "搜索"}
          </button>
        </form>
        <p
          aria-live="polite"
          className={`overview-search-status${searchErrorMessage ? " is-error" : ""}`}
        >
          {searchErrorMessage ||
            (submittedQuery
              ? `“${submittedQuery}” · 命中 ${searchResults.length} 条完整知识`
              : "使用与实时面试相同的 BM25 + pgvector 混合排序，最多返回两条")}
        </p>
      </div>

      <div className="overview-refresh-slot">
        {(refreshMessage || refreshErrorMessage) && (
          <p
            aria-live="polite"
            className={`overview-refresh-message${refreshErrorMessage ? " is-error" : ""}`}
          >
            {refreshErrorMessage || refreshMessage}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="overview-state">
          <LoaderCircle className="is-spinning" size={22} />
          正在读取完整知识库
        </div>
      ) : errorMessage ? (
        <div className="overview-state is-error">{errorMessage}</div>
      ) : submittedQuery && visibleDocuments.length === 0 ? (
        <div className="overview-state">
          <Search size={22} />
          没有找到相关知识，请换一个英文问题
        </div>
      ) : (
        <div className={`overview-grid${submittedQuery ? " is-search-results" : ""}`}>
          {visibleDocuments.map((document, index) => (
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
