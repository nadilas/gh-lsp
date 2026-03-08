import { test, expect } from './fixtures';

/**
 * E2E tests for toggling the extension on/off.
 *
 * Tests verify that disabling the extension prevents hover behavior
 * and re-enabling it restores functionality.
 */
test.describe('Extension toggle', () => {
  test('disabling extension removes shadow host from code page', async ({
    context,
    popupPage,
  }) => {
    // First navigate to a code page
    const page = await context.newPage();
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    // Wait for content script to activate
    await page.waitForTimeout(2_000);

    // Verify extension is active (shadow host exists)
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    // Disable extension via popup toggle
    const toggle = popupPage.getByRole('checkbox');
    if (await toggle.isVisible()) {
      await toggle.uncheck();
      await popupPage.waitForTimeout(500);
    }

    // Reload the code page to observe the disabled state
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(2_000);

    // When extension is disabled, the content script should not activate
    // and no shadow host should be created
    const hostAfterDisable = page.locator('#gh-lsp-root');
    await expect(hostAfterDisable).toHaveCount(0);

    await page.close();
  });

  test('re-enabling extension restores functionality', async ({
    context,
    popupPage,
  }) => {
    // Disable first
    const toggle = popupPage.getByRole('checkbox');
    if (await toggle.isVisible()) {
      await toggle.uncheck();
      await popupPage.waitForTimeout(500);
    }

    // Re-enable
    if (await toggle.isVisible()) {
      await toggle.check();
      await popupPage.waitForTimeout(500);
    }

    // Navigate to a code page
    const page = await context.newPage();
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // Extension should be active again
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    await page.close();
  });
});
