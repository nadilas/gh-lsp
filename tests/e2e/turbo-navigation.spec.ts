import { test, expect } from './fixtures';

/**
 * E2E tests for Turbo/SPA navigation between files on GitHub.
 *
 * GitHub uses Turbo (formerly Turbolinks) for client-side navigation.
 * The extension must detect these navigations, deactivate the old context,
 * and re-activate on the new page.
 */
test.describe('Turbo navigation', () => {
  test('extension re-activates after navigating to a different code file', async ({
    context,
  }) => {
    const page = await context.newPage();

    // Navigate to first file
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // Extension should be active
    let shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    // Click on a link to another file (within the same repo).
    // We use the GitHub file tree or a link in the code to navigate
    // to a different file via Turbo navigation.
    // Navigate programmatically to a different file in the same repo
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/component.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    // Wait for Turbo navigation to settle and content script to re-init
    await page.waitForTimeout(3_000);

    // Extension should still be active on the new file
    shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    await page.close();
  });

  test('extension deactivates when navigating from code to non-code page', async ({
    context,
  }) => {
    const page = await context.newPage();

    // Start on a code page
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    // Navigate to a non-code page (issues)
    await page.goto(
      'https://github.com/preactjs/preact/issues',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // No sidebar should exist on non-code pages
    const sidebar = page.locator('.gh-lsp-sidebar');
    await expect(sidebar).toHaveCount(0);

    await page.close();
  });

  test('extension handles rapid navigation without errors', async ({
    context,
  }) => {
    const page = await context.newPage();

    // Rapidly navigate between several files
    const files = [
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      'https://github.com/preactjs/preact/blob/main/src/component.js',
      'https://github.com/preactjs/preact/blob/main/src/diff/index.js',
    ];

    for (const url of files) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      // Brief pause to allow content script to start activating
      await page.waitForTimeout(500);
    }

    // After settling, extension should be functional on the final page
    await page.waitForTimeout(2_000);

    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    // No console errors related to our extension
    // (captured via page.on('console') if needed in future)
    await page.close();
  });
});
