import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  ASSISTANT_MARKDOWN,
  expectEnhancedReply,
  withAssistantBodyPlugin,
} from "../support/helpers/assistant-body-plugin";
import {
  expectChatHistoryAttachment,
  expectInFlightForkAvailable,
  observeForkAttachment,
} from "../support/helpers/assistant-fork";

async function expectCopiedText(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
}

for (const width of [1100, 390]) {
  test(`enhanced assistant keeps copy and fork across streaming at width ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const attachment = observeForkAttachment(page);
    await withAssistantBodyPlugin(page, info, { streaming: true }, async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "Show the original formula and diagram.");
      await expect(page.getByRole("heading", { name: "Enhanced part 1 streaming" })).toBeVisible();
      await expectInFlightForkAvailable(page);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expectEnhancedReply(page, ASSISTANT_MARKDOWN);

      const copy = page.getByRole("button", { name: "Copy turn", exact: true });
      const fork = page.getByRole("button", { name: "Fork chat from here", exact: true });
      await expect(copy).toHaveCount(1);
      await expect(fork).toHaveCount(1);
      await copy.click();
      await expectCopiedText(page, ASSISTANT_MARKDOWN);
      await info.attach("enhanced-reply-actions", {
        body: await page.screenshot({ path: info.outputPath("enhanced-reply-actions.png") }),
        contentType: "image/png",
      });

      const laterPrompt = "This later turn must be excluded from the earlier fork.";
      await agent.client.sendAgentMessage(agent.agentId, laterPrompt);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expect(copy).toHaveCount(2);
      await expect(fork).toHaveCount(2);
      await fork.first().click();
      await page.getByRole("menuitem", { name: "Fork in a new tab", exact: true }).click();
      await expectChatHistoryAttachment(page);
      const history = await attachment.waitForText();
      expect(history).toContain(ASSISTANT_MARKDOWN);
      expect(history).not.toContain(laterPrompt);
      expect(history).not.toContain("Enhanced part");
    });
  });

  test(`enhanced final reply survives turn collapse at width ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await withAssistantBodyPlugin(page, info, { streaming: false }, async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "emit 2 tool agent stream updates");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expectEnhancedReply(page, "Completed 2 commands");
      const summary = page
        .getByTestId("turn-summary")
        .getByRole("button", { name: "Ran 2 commands", exact: true });
      const tools = page.getByTestId("tool-call-badge");
      await expect(summary).toBeVisible();
      await expect(tools).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copy turn", exact: true })).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Fork chat from here", exact: true }),
      ).toHaveCount(1);

      await summary.click();
      await expect(tools).toHaveCount(2);
      await expect(page.getByText("echo stress-0", { exact: true })).toBeVisible();
      await expect(page.getByText("echo stress-1", { exact: true })).toBeVisible();
      await expectEnhancedReply(page, "Completed 2 commands");
      await summary.click();
      await expect(tools).toHaveCount(0);
      await expectEnhancedReply(page, "Completed 2 commands");
      await info.attach("enhanced-reply-collapsed", {
        body: await page.screenshot({ path: info.outputPath("enhanced-reply-collapsed.png") }),
        contentType: "image/png",
      });
    });
  });
}
