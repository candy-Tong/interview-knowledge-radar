import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";

export type RuntimeLogEntry = {
  event: string;
  sessionId?: string;
  [key: string]: unknown;
};

export type RuntimeLogWriter = (entry: RuntimeLogEntry) => Promise<void>;

type RuntimeLogWriterOptions = {
  directory?: string;
  now?: () => Date;
};

const sensitiveKeyPattern = /api[-_]?key|authorization|password|secret|access[-_]?token/i;

/** Redacts credentials while preserving useful local error and event context. */
function redactRuntimeLogValue(key: string, value: unknown) {
  if (sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

/** Creates a serialized JSONL writer so concurrent realtime events stay line-safe and ordered. */
export function createRuntimeLogWriter(options: RuntimeLogWriterOptions = {}) {
  const directory = resolve(options.directory ?? config.RUNTIME_LOG_DIR);
  const now = options.now ?? (() => new Date());
  let writeQueue = Promise.resolve();

  return (entry: RuntimeLogEntry) => {
    const timestamp = now().toISOString();
    const line = `${JSON.stringify({ timestamp, ...entry }, redactRuntimeLogValue)}\n`;
    const filePath = resolve(directory, `${timestamp.slice(0, 10)}.jsonl`);
    const write = async () => {
      await mkdir(directory, { recursive: true });
      await appendFile(filePath, line, "utf8");
    };
    writeQueue = writeQueue.then(write, write);
    return writeQueue;
  };
}

export const writeRuntimeLog = createRuntimeLogWriter();
