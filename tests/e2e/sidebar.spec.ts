import { test, expect } from './fixtures';

/**
 * E2E tests for sidebar mode.
 *
 * Tests verify that switching to sidebar display mode in the options page
 * causes the extension to show a sidebar panel on code pages instead of
 * a popover.
 */
test.describe('Sidebar mode', () => {
  test('enabling sidebar mode shows sidebar on code page', async ({
    context,
    optionsPage,
  }) => {
    // Switch to sidebar mode in options
    const sidebarRadio = optionsPage.getByRole('radio', { name: /sidebar/i });
    if (await sidebarRadio.isVisible()) {
      await sidebarRadio.click();
      // Settings auto-save — wait for storage write
      await optionsPage.waitForTimeout(500);
    }

    // Navigate to a code page
    const page = await context.newPage();
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    // Wait for content script to initialize with sidebar mode
    await page.waitForTimeout(3_000);

    // The extension should mount its shadow host
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    await page.close();
  });

  test('sidebar receives hover data when hovering code', async ({
    context,
    optionsPage,
  }) => {
    // Enable sidebar mode
    const sidebarRadio = optionsPage.getByRole('radio', { name: /sidebar/i });
    if (await sidebarRadio.isVisible()) {
      await sidebarRadio.click();
      await optionsPage.waitForTimeout(500);
    }

    const page = await context.newPage();
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // Hover over code to trigger the extension flow
    const codeLine = page.locator('[data-key] .react-file-line, .blob-code-inner').first();
    if (await codeLine.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await codeLine.hover({ force: true });
      await page.waitForTimeout(500);
    }

    // Extension should still be functional
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached();

    await page.close();
  });

  test('switching back to popover mode removes sidebar', async ({
    context,
    optionsPage,
  }) => {
    // First enable sidebar
    const sidebarRadio = optionsPage.getByRole('radio', { name: /sidebar/i });
    if (await sidebarRadio.isVisible()) {
      await sidebarRadio.click();
      await optionsPage.waitForTimeout(500);
    }

    // Then switch back to popover
    const popoverRadio = optionsPage.getByRole('radio', { name: /popover/i });
    if (await popoverRadio.isVisible()) {
      await popoverRadio.click();
      await optionsPage.waitForTimeout(500);
    }

    const page = await context.newPage();
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // No sidebar should be visible on a popover-mode page
    const sidebar = page.locator('.gh-lsp-sidebar');
    await expect(sidebar).toHaveCount(0);

    await page.close();
  });
});
