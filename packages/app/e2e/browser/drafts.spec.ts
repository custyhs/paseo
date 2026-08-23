import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { ensureSidePanel } from "../support/helpers/workspace-tabs";
import type { Page } from "@playwright/test";

/** React Native web keeps offscreen copies around; assert against the shown one. */
function shown(page: Page, testId: string | RegExp) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

/**
 * The drafts surfaces, driven the way a person drives them.
 *
 * Four defects reached a human before anything caught them: the destination
 * rendered with no sidebar and no way back, the Scratchpad refused to open, its
 * pickers listed nothing, and the version climbed once per keystroke. None was a
 * type error; three were members left unnamed in places that enumerate the
 * existing ones. Unit tests now pin the seams, but only a real click proves the
 * surfaces are reachable at all.
 */

test.describe("Drafts destination", () => {
  test("opens from the sidebar and keeps the chrome that leads back out", async ({ page }) => {
    await gotoAppShell(page);
    await expect(shown(page, "sidebar-drafts")).toBeVisible({ timeout: 60_000 });
    await shown(page, "sidebar-drafts").click();

    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    // The app chrome is an allowlist of pathnames. A destination missing from it
    // renders without the sidebar, which is the only way back to a workspace.
    await expect(shown(page, "sidebar-sessions")).toBeVisible();
    await shown(page, "sidebar-sessions").click();
    // The router keeps the previous screen mounted, so ask whether it is shown
    // rather than whether it exists.
    await expect(page.getByTestId("drafts-screen").filter({ visible: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test("creates a draft that opens straight into an editor", async ({ page }) => {
    await gotoAppShell(page);
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    await shown(page, "drafts-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });
  });

  test("lists somewhere to plan a draft for", async ({ page, withWorkspace }) => {
    // The picker reads workspaces out of the session store, where they live in a
    // Map. `Object.values()` on a Map yields nothing and type-checks anyway, so
    // this listed zero options while every static check stayed green.
    const workspace = await withWorkspace({ prefix: "drafts-plan-" });
    await workspace.navigateTo();

    await shown(page, "sidebar-drafts").click();
    await shown(page, "drafts-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });

    await shown(page, "draft-add-plan").click();
    await expect(shown(page, /^plan-option-/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Scratchpad side panel", () => {
  test("opens from the pane menu instead of doing nothing", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "drafts-scratchpad-" });
    await workspace.navigateTo();

    // `openTab` refuses a target the normalizer does not recognise, and a refusal
    // looks exactly like a click that did nothing.
    const panel = await ensureSidePanel(page);
    await panel.getByTestId("workspace-new-tab-menu-trigger").click();
    await shown(page, "workspace-new-tab-menu-scratchpad").click();

    await expect(shown(page, "scratchpad-panel")).toBeVisible({ timeout: 30_000 });
  });

  test("a draft started here is planned for this workspace", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "drafts-scratchpad-plan-" });
    await workspace.navigateTo();

    const panel = await ensureSidePanel(page);
    await panel.getByTestId("workspace-new-tab-menu-trigger").click();
    await shown(page, "workspace-new-tab-menu-scratchpad").click();
    await expect(shown(page, "scratchpad-panel")).toBeVisible({ timeout: 30_000 });

    await shown(page, "scratchpad-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });

    // Planning follows where the user is standing, so this one arrives planned.
    await expect(shown(page, "draft-add-plan")).toBeVisible();
  });
});
