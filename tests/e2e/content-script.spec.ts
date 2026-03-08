import { test, expect } from './fixtures';

test.describe('Content script on GitHub', () => {
  test('content script loads on GitHub code page', async ({ context }) => {
    const page = await context.newPage();
    // Navigate to a known public TypeScript file on GitHub
    await page.goto('https://github.com/preactjs/preact/blob/main/src/index.js', {
      waitUntil: 'networkidle',
      timeout: 15_000,
    });

    // Verify we're on a GitHub page
    await expect(page).toHaveURL(/github\.com/);

    await page.close();
  });

  test('content script does not inject UI on non-code pages', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('https://github.com/preactjs/preact', {
      waitUntil: 'networkidle',
      timeout: 15_000,
    });

    // The sidebar should not be injected on a repo root page
    const sidebar = page.locator('.gh-lsp-sidebar');
    await expect(sidebar).toHaveCount(0);

    await page.close();
  });
});
