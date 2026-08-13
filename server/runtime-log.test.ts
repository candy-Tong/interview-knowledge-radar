import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeLogWriter } from "./runtime-log.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("runtime log", () => {
  it("serializes concurrent events into the daily JSONL file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-radar-log-"));
    temporaryDirectories.push(directory);
    const writeLog = createRuntimeLogWriter({
      directory,
      now: () => new Date("2026-08-13T09:30:00.000Z"),
    });

    await Promise.all([
      writeLog({ event: "recognition.partial", sessionId: "session-1", text: "Tell me" }),
      writeLog({
        event: "knowledge.retrieval.completed",
        sessionId: "session-1",
        results: [{ sourceName: "monorepo.md" }],
        apiKey: "sk-sensitive-value",
        diagnostic: "postgresql://user:password@example.com/database",
      }),
    ]);

    const lines = (await readFile(join(directory, "2026-08-13.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      {
        timestamp: "2026-08-13T09:30:00.000Z",
        event: "recognition.partial",
        sessionId: "session-1",
        text: "Tell me",
      },
      {
        timestamp: "2026-08-13T09:30:00.000Z",
        event: "knowledge.retrieval.completed",
        sessionId: "session-1",
        results: [{ sourceName: "monorepo.md" }],
        apiKey: "[REDACTED]",
        diagnostic: "postgresql://user:[REDACTED]@example.com/database",
      },
    ]);
  });
});
