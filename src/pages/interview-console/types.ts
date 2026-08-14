export enum SessionPhase {
  Idle = "idle",
  Connecting = "connecting",
  Listening = "listening",
  HearingSpeech = "hearing_speech",
  Finishing = "finishing",
  Error = "error",
}

export enum ConsoleView {
  Interview = "interview",
  Knowledge = "knowledge",
}

export enum RealtimeMode {
  Translation = "translation",
  Transcription = "transcription",
}

export type KnowledgeDocument = {
  id: string;
  sourceName: string;
  heading: string;
  content: string;
  updatedAt: string;
};

export type KnowledgeResult = {
  id: string;
  sourceName: string;
  heading: string;
  content: string;
  bm25Score: number;
  vectorScore: number;
  hybridScore: number;
  focusStart: number;
  focusEnd: number;
  rerank?: {
    status: "applied" | "skipped" | "failed" | "superseded";
    durationMs: number;
    model: string;
    score?: number;
    totalTokens?: number;
    error?: string;
  };
};

export type InterviewQuestion = {
  id: string;
  text: string;
  isFinal: boolean;
  knowledgeResults: KnowledgeResult[];
  knowledgeError?: string;
};

export type TranscriptSegment = {
  itemId: string;
  mode: RealtimeMode;
  sourceText: string;
  translatedText: string;
  isSourceFinal: boolean;
  isTranslationFinal: boolean;
  questions: InterviewQuestion[];
  createdAt: number;
};

export type ServiceHealth = {
  databaseReady: boolean;
  dashScopeReady: boolean;
  questionSplitterReady: boolean;
  questionSplitterModel: string;
  asrModel: string;
  translationModel: string;
  embeddingModel: string;
  rerankModel: string;
  rerankMinimumIntervalMs: number;
};

export type KnowledgeStats = {
  documents: number;
  chunks: number;
  vectors: number;
};

export type KnowledgeRefreshResult = {
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  ignored: number;
  embedded: number;
  stats: KnowledgeStats;
};
