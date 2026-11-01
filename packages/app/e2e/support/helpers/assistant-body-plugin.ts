import { expect, type Page, type TestInfo } from "@playwright/test";
import { expectComposerVisible } from "./composer";
import { openAgentRoute, seedMockAgentWorkspace, type MockAgentWorkspace } from "./mock-agent";
import { withDirectoryPlugin } from "./plugin-timeline";

export const ASSISTANT_MARKDOWN = [
  "A formula and a diagram share this assistant reply.",
  "$$\\frac{a+b}{c+d} = \\sum_{i=1}^{n} x_i$$",
  "```mermaid\ngraph LR\n  A[Original source] --> B[Enhanced body]\n```",
  "The final paragraph must survive copying and forking, including **its Markdown**.",
].join("\n\n");

// Use the public transformer/renderer contract and deliberately return two body
// items. Host actions must use the original message once, not the rendered labels.
const CLIENT_SOURCE = `import React from "react";
import { Text, View } from "react-native";
import { z } from "zod";

function Part({ item }) {
  return <View testID="enhanced-assistant-part">
    <Text accessibilityRole="header">{"Enhanced part " + item.data.part + " " + item.data.phase}</Text>
    <Text testID="enhanced-assistant-text">{item.data.text}</Text>
  </View>;
}

export default function contribute(client) {
  client.addTimelineTransformer({
    id: "assistant-body",
    query: { itemType: "assistant_message" },
    transform({ item, phase }) {
      const split = item.text.indexOf("\\n\\n");
      const parts = split < 0 ? [item.text, ""] : [item.text.slice(0, split), item.text.slice(split + 2)];
      return { items: parts.map((text, index) => ({
        type: "plugin", kind: "part", version: 1,
        data: { part: index + 1, text, phase },
      })) };
    },
  });
  client.addTimelineRenderer({
    kind: "part", version: 1,
    schema: z.object({ part: z.number(), text: z.string(), phase: z.enum(["streaming", "complete"]) }),
    Component: Part,
  });
  return () => {};
}`;

export async function withAssistantBodyPlugin(
  page: Page,
  info: TestInfo,
  options: { streaming: boolean },
  run: (agent: MockAgentWorkspace) => Promise<void>,
): Promise<void> {
  info.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ chatDisplay: "collapseTurns" }));
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "assistant-body-plugin-",
    title: "Enhanced assistant semantics",
    featureValues: options.streaming
      ? {
          mockStreamingAssistantResponse: ASSISTANT_MARKDOWN,
          mockStreamingAssistantIntervalMs: 150,
        }
      : {},
  });
  try {
    await withDirectoryPlugin({
      pluginId: "assistant-body-e2e",
      source: CLIENT_SOURCE,
      run: async () => {
        try {
          await openAgentRoute(page, agent);
          await expectComposerVisible(page);
          await run(agent);
        } catch (error) {
          await info.attach("enhanced-reply-before-cleanup", {
            body: await page.screenshot({
              path: info.outputPath("enhanced-reply-before-cleanup.png"),
            }),
            contentType: "image/png",
          });
          throw error;
        }
      },
    });
  } finally {
    await agent.cleanup();
  }
}

export async function expectEnhancedReply(page: Page, text: string): Promise<void> {
  const parts = page.getByTestId("enhanced-assistant-part");
  await expect(parts).toHaveCount(2);
  await expect(parts.first()).toContainText("Enhanced part 1 complete");
  await expect(parts.last()).toContainText("Enhanced part 2 complete");
  const separator = text.indexOf("\n\n");
  const expected =
    separator < 0 ? [text, ""] : [text.slice(0, separator), text.slice(separator + 2)];
  await expect(page.getByTestId("enhanced-assistant-text")).toHaveText(expected);
}
