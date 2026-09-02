import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { ensureExplorerSidebar } from "../support/helpers/workspace-tabs";
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

  /**
   * The one test that can tell the daemon apart from the mock. The mock lives in
   * the page, so a reload wipes it; the daemon writes to disk, so a reload finds
   * the words again. That is also the product's whole first promise, which makes
   * it worth a real browser rather than a unit test of the seam.
   */
  test("a draft written here survives a reload", async ({ page }) => {
    await gotoAppShell(page);
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    await shown(page, "drafts-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });

    const words = `survives a reload ${Date.now()}`;
    await shown(page, "draft-body").fill(words);
    // Writes are debounced on a pause, and the daemon has to acknowledge before
    // the header stops saying otherwise.
    await expect(shown(page, "draft-editor")).toContainText("Saved", { timeout: 15_000 });

    await page.reload();
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    // Offscreen copies again: `.first()` alone finds an invisible one and then
    // waits forever for it to be visible.
    await expect(page.getByText(words).filter({ visible: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  /**
   * Archiving is reachable and reversible. The control is hover-revealed on web
   * (`docs/hover.md`), so this also proves the reveal actually works rather than
   * the row eating the pointer — Playwright hovers for real.
   */
  test("a draft can be archived and brought back", async ({ page }) => {
    await gotoAppShell(page);
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    await shown(page, "drafts-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });
    const words = `archive me ${Date.now()}`;
    await shown(page, "draft-body").fill(words);
    await expect(shown(page, "draft-editor")).toContainText("Saved", { timeout: 15_000 });

    const row = page.getByText(words).filter({ visible: true }).first();
    await row.hover();
    const archive = page
      .getByTestId(/^draft-archive-/)
      .filter({ visible: true })
      .first();
    await archive.click();

    // Gone from the everyday list. Scoped to the list: the editor still holds
    // the draft you just archived, which is correct and not what is being asked.
    await expect(shown(page, "drafts-list").getByText(words).filter({ visible: true })).toHaveCount(
      0,
      { timeout: 15_000 },
    );

    // ...and reachable again without remembering what it said. Search finds it
    // too, but the words are exactly what archiving takes away from you, so the
    // toggle is the path that has to work.
    await shown(page, "drafts-show-archived").click();
    const archivedGroup = shown(page, "drafts-archived-group");
    await expect(archivedGroup).toBeVisible({ timeout: 15_000 });
    // The control is hover-revealed, so it has to be hovered again here — the
    // earlier hover was on a different row.
    await archivedGroup.getByText(words).filter({ visible: true }).first().hover();
    await archivedGroup
      .getByTestId(/^draft-archive-/)
      .filter({ visible: true })
      .first()
      .click();
    // Unarchived, so the group empties and the draft is back in the list.
    await expect(page.getByTestId("drafts-archived-group").filter({ visible: true })).toHaveCount(
      0,
      { timeout: 15_000 },
    );
    await expect(
      shown(page, "drafts-list").getByText(words).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  /**
   * The title rendered as read-only text for a long time and nobody noticed,
   * because `draftDisplayTitle` falls back to the body's first line — so a
   * draft always had a heading, it just was not yours to set.
   */
  test("a draft title can be typed and survives a reload", async ({ page }) => {
    await gotoAppShell(page);
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    await shown(page, "drafts-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });

    const title = `title ${Date.now()}`;
    await shown(page, "draft-title").fill(title);
    await shown(page, "draft-body").fill("body that would otherwise be the heading");
    await expect(shown(page, "draft-editor")).toContainText("Saved", { timeout: 15_000 });

    await page.reload();
    await shown(page, "sidebar-drafts").click();
    await expect(shown(page, "drafts-screen")).toBeVisible({ timeout: 30_000 });

    // The stored title wins over the body's first line, which is how you can
    // tell it was really saved rather than derived.
    await expect(
      shown(page, "drafts-list").getByText(title).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
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
    //
    // The menu item's id comes from the launch catalog, so `-scratchpad` is
    // generated rather than hand-placed. The trigger is not: upstream renamed it
    // from `workspace-new-tab-menu-trigger` in #3715.
    const panel = await ensureExplorerSidebar(page);
    await panel.getByTestId("workspace-new-tab-button").click();
    await shown(page, "workspace-new-tab-menu-scratchpad").click();

    await expect(shown(page, "scratchpad-panel")).toBeVisible({ timeout: 30_000 });
  });

  test("a draft started here is planned for this workspace", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "drafts-scratchpad-plan-" });
    await workspace.navigateTo();

    const panel = await ensureExplorerSidebar(page);
    await panel.getByTestId("workspace-new-tab-button").click();
    await shown(page, "workspace-new-tab-menu-scratchpad").click();
    await expect(shown(page, "scratchpad-panel")).toBeVisible({ timeout: 30_000 });

    await shown(page, "scratchpad-new-draft").click();
    await expect(shown(page, "draft-editor")).toBeVisible({ timeout: 15_000 });

    // Planning follows where the user is standing, so this one arrives planned.
    await expect(shown(page, "draft-add-plan")).toBeVisible();
  });
});
