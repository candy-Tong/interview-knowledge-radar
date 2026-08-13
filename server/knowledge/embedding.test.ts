import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DASHSCOPE_API_KEY", "test-key");
  vi.stubEnv("DASHSCOPE_WORKSPACE_ID", "test-workspace");
  vi.stubEnv("DASHSCOPE_REGION", "cn-beijing");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createEmbeddings", () => {
  it("calls the workspace endpoint and requests 1024-dimensional vectors", async () => {
    const embedding = Array.from({ length: 1024 }, () => 0.125);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createEmbeddings } = await import("./embedding.js");

    await expect(createEmbeddings(["Tell me about your monorepo"])).resolves.toEqual([
      embedding,
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings",
    );
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: "text-embedding-v4",
      input: ["Tell me about your monorepo"],
      dimensions: 1024,
    });
  });

  it("rejects vectors with an unexpected dimension", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { createEmbeddings } = await import("./embedding.js");

    await expect(createEmbeddings(["question"])).rejects.toThrow("1024 维向量");
  });
});
