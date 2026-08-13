const englishStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

/** Normalizes English text into terms shared by ingestion and BM25 queries. */
export function tokenizeEnglish(value: string) {
  return (value.toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) ?? [])
    .map(normalizeTerm)
    .filter((term) => term.length > 1 && !englishStopWords.has(term));
}

export type RelevantPassage = {
  focusStart: number;
  focusEnd: number;
};

/** Finds the most lexically relevant sentence while keeping the source document intact. */
export function locateRelevantPassage(content: string, query: string): RelevantPassage {
  const orderedQueryTerms = [...new Set(tokenizeEnglish(query))];
  if (orderedQueryTerms.length === 0) {
    return { focusStart: 0, focusEnd: 0 };
  }
  const queryTermWeights = new Map(
    orderedQueryTerms.map((term, index) => [
      term,
      1 + (orderedQueryTerms.length - index) / orderedQueryTerms.length,
    ]),
  );
  const totalQueryWeight = [...queryTermWeights.values()].reduce((total, weight) => total + weight, 0);

  const sentencePattern = /[^.!?。！？\n]+(?:[.!?。！？]+|(?=\n|$))/g;
  let bestPassage: RelevantPassage | undefined;
  let bestScore = 0;

  for (const match of content.matchAll(sentencePattern)) {
    const rawSentence = match[0];
    const trimmedSentence = rawSentence.trim();
    if (!trimmedSentence) {
      continue;
    }

    const sentenceTerms = tokenizeEnglish(trimmedSentence);
    const matchingTerms = sentenceTerms.filter((term) => queryTermWeights.has(term));
    if (matchingTerms.length === 0) {
      continue;
    }

    const uniqueMatches = [...new Set(matchingTerms)];
    const matchedQueryWeight = uniqueMatches.reduce(
      (total, term) => total + (queryTermWeights.get(term) ?? 0),
      0,
    );
    const coverage = matchedQueryWeight / totalQueryWeight;
    const density = matchingTerms.length / Math.sqrt(Math.max(sentenceTerms.length, 1));
    const score = coverage * 12 + density;
    if (score <= bestScore) {
      continue;
    }

    const leadingWhitespace = rawSentence.length - rawSentence.trimStart().length;
    const focusStart = (match.index ?? 0) + leadingWhitespace;
    bestPassage = {
      focusStart,
      focusEnd: focusStart + trimmedSentence.length,
    };
    bestScore = score;
  }

  return bestPassage ?? { focusStart: 0, focusEnd: 0 };
}

/** Applies a deliberately small stemmer to improve interview-question recall. */
function normalizeTerm(value: string) {
  if (value.length > 5 && value.endsWith("ing")) {
    return value.slice(0, -3);
  }
  if (value.length > 4 && value.endsWith("ed")) {
    return value.slice(0, -2);
  }
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

/** Normalizes one Markdown file into one complete searchable knowledge entry. */
export function prepareMarkdownDocument(sourceName: string, markdown: string) {
  const cleaned = markdown.replace(/<br\s*\/?>/gi, "\n").replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return null;
  }

  const [firstLine = "", ...remainingLines] = cleaned.split("\n");
  const markdownHeading = firstLine.match(/^#{1,6}\s+(.+)$/);
  const heading = markdownHeading?.[1].trim() || sourceName.replace(/\.md$/i, "");
  const content = markdownHeading ? remainingLines.join("\n").trim() : cleaned;

  return { heading, content: content || cleaned };
}

/** Counts terms for the materialized BM25 index. */
export function countTerms(value: string) {
  const terms = tokenizeEnglish(value);
  const termFrequency = new Map<string, number>();
  for (const term of terms) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  }
  return { terms, termFrequency };
}
