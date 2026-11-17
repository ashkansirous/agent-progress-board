import { expect, type Locator, type Page } from "@playwright/test";

/** The block of the project named `name` (its header button holds the name, the summary line and Fold or Open). */
export function project(page: Page, name: string): Locator {
  return page.locator("section.project", { has: page.locator(".project-name").getByText(name, { exact: true }) });
}

/** The header button of a project block: it carries `aria-expanded`. */
export function projectToggle(block: Locator): Locator {
  return block.locator("button.project-toggle");
}

/** Opens every folded block on the page (quiet projects are folded on load); waits for the first block to draw. */
export async function openAllProjects(page: Page): Promise<void> {
  const toggles = page.locator("button.project-toggle");
  await expect(toggles.first()).toBeVisible();
  for (const toggle of await toggles.all()) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
}

/** Opens a block that is folded (a quiet project is folded on load) and waits until it is open. */
export async function openProject(block: Locator): Promise<Locator> {
  const toggle = projectToggle(block);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return block;
}
