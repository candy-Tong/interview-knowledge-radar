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
};

export type TranscriptSegment = {
  itemId: string;
  sourceText: string;
  translatedText: string;
  isSourceFinal: boolean;
  isTranslationFinal: boolean;
  knowledgeResults: KnowledgeResult[];
  knowledgeError?: string;
  createdAt: number;
};

export type ServiceHealth = {
  databaseReady: boolean;
  dashScopeReady: boolean;
  translationModel: string;
  embeddingModel: string;
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
