import { describe, expect, it, vi } from "vitest";
import { getStreamItemMessageId, type AssistantMessageItem, type StreamItem } from "@/types/stream";
import type { TimelineItemTransform } from "./model";
import { projectPluginTimelineItems } from "./projection";

function thought(text: string, status: "loading" | "ready" = "loading"): StreamItem {
  return {
    kind: "thought",
    id: "thought-1",
    text,
    status,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("plugin timeline projection", () => {
  it("keeps one source assistant row when a transformer returns several body items", () => {
    const source: AssistantMessageItem = {
      kind: "assistant_message",
      id: "assistant-1",
      messageId: "provider-1",
      turnId: "turn-1",
      timelineCursor: { epoch: "epoch-1", seq: 3 },
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      text: "Formula $x^2$ followed by a diagram.",
    };
    const transform: TimelineItemTransform = ({ sourceId }) =>
      ["formula", "diagram"].map((part) => ({
        type: "plugin",
        id: `${sourceId}/${part}`,
        pluginId: "markdown",
        kind: "body",
        version: 1,
        data: { part },
      }));

    const projected = projectPluginTimelineItems([source], transform);

    expect(projected).toMatchObject([
      {
        ...source,
        pluginBody: [
          { kind: "plugin", id: "markdown/assistant-1/formula", sourceId: source.id },
          { kind: "plugin", id: "markdown/assistant-1/diagram", sourceId: source.id },
        ],
      },
    ]);
    expect(projected.map(getStreamItemMessageId)).toEqual([source.id]);
    expect(projectPluginTimelineItems([source], transform)[0]).toBe(projected[0]);
    expect(source.pluginBody).toBeUndefined();
    expect(projectPluginTimelineItems([source], () => [])).toEqual([]);
    expect(projectPluginTimelineItems([source], () => undefined)[0]).toBe(source);
  });

  it("leaves canonical plugin rows outside assistant-message semantics", () => {
    const source: StreamItem = {
      kind: "plugin",
      id: "notice-1",
      pluginId: "notifications",
      pluginItemId: "notice-1",
      itemKind: "notice",
      version: 1,
      data: { text: "Background task completed" },
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    };
    let calls = 0;
    const projected = projectPluginTimelineItems([source], () => {
      calls += 1;
      return [];
    });

    expect(projected[0]).toBe(source);
    expect(calls).toBe(0);
  });

  it("does not expose mutable tool detail from stream state", () => {
    const detail = { type: "read" as const, filePath: "/repo/original.ts" };
    const source: StreamItem = {
      kind: "tool_call",
      id: "tool-1",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      payload: {
        source: "agent",
        data: {
          provider: "claude",
          callId: "call-1",
          name: "Read",
          status: "completed",
          error: null,
          detail,
        },
      },
    };
    const mutateDetail: TimelineItemTransform = ({ item }) => {
      if (item.type === "tool_call" && item.detail.type === "read") {
        item.detail.filePath = "/repo/mutated.ts";
      }
      return undefined;
    };

    expect(() => projectPluginTimelineItems([source], mutateDetail)).toThrow(TypeError);
    expect(detail.filePath).toBe("/repo/original.ts");
  });

  it("projects a streaming reasoning row from its first delta", () => {
    const transform: TimelineItemTransform = vi.fn(({ item, phase, sourceId }) => [
      {
        type: "plugin" as const,
        id: `${sourceId}/0`,
        pluginId: "inline-thinking",
        kind: "reasoning",
        version: 1,
        data: { text: item.type === "reasoning" ? item.text : "", phase },
      },
    ]);

    expect(projectPluginTimelineItems([thought("First")], transform)).toMatchObject([
      {
        kind: "plugin",
        id: "inline-thinking/thought-1/0",
        data: { text: "First", phase: "streaming" },
      },
    ]);
  });

  it("memoizes projection on the source row reference", () => {
    const source = thought("Stable");
    const transform: TimelineItemTransform = vi.fn(() => undefined);
    projectPluginTimelineItems([source], transform);
    projectPluginTimelineItems([source], transform);

    expect(transform).toHaveBeenCalledOnce();
  });

  it("preserves whether a notification row came from an agent error or a notice", () => {
    const transform: TimelineItemTransform = vi.fn(() => undefined);
    const timestamp = new Date("2026-01-01T00:00:00.000Z");

    projectPluginTimelineItems(
      [
        {
          kind: "notification",
          sourceType: "error",
          id: "error-1",
          level: "error",
          message: "Agent failed",
          timestamp,
        },
        {
          kind: "notification",
          sourceType: "notification",
          id: "notice-1",
          level: "error",
          message: "Extension reported an error",
          timestamp,
        },
      ],
      transform,
    );

    expect(transform).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ item: { type: "error", message: "Agent failed" } }),
    );
    expect(transform).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        item: {
          type: "notification",
          level: "error",
          message: "Extension reported an error",
        },
      }),
    );
  });

  it("reprojects when streaming produces a new source row", () => {
    const transform: TimelineItemTransform = vi.fn(() => undefined);
    projectPluginTimelineItems([thought("First")], transform);
    projectPluginTimelineItems([thought("First second")], transform);

    expect(transform).toHaveBeenCalledTimes(2);
  });

  it("filters and explodes source rows", () => {
    const source = thought("Split", "ready");
    const exploded = projectPluginTimelineItems([source], ({ sourceId }) => [
      {
        type: "plugin",
        id: `${sourceId}/left`,
        pluginId: "split",
        kind: "part",
        version: 1,
        data: { side: "left" },
      },
      {
        type: "plugin",
        id: `${sourceId}/right`,
        pluginId: "split",
        kind: "part",
        version: 1,
        data: { side: "right" },
      },
    ]);
    const filtered = projectPluginTimelineItems([source], () => []);

    expect(exploded.map((item) => item.id)).toEqual([
      "split/thought-1/left",
      "split/thought-1/right",
    ]);
    expect(filtered).toEqual([]);
  });
});
