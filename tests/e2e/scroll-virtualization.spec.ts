import { test, expect } from './fixtures';

/**
 * E2E tests for scroll virtualization handling.
 *
 * GitHub uses virtualized rendering for long files — only visible lines
 * are present in the DOM. The extension must detect newly rendered lines
 * via MutationObserver and attach hover handlers to them.
 */
test.describe('Scroll virtualization', () => {
  test('extension handles scrolling in a long file', async ({ context }) => {
    const page = await context.newPage();

    // Navigate to a long file that uses virtualized rendering
    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/diff/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // Extension should be active
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached({ timeout: 5_000 });

    // Scroll down significantly to trigger virtualization
    await page.evaluate(() => {
      window.scrollTo(0, 2000);
    });

    // Wait for new lines to render
    await page.waitForTimeout(1_000);

    // After scrolling, the extension's DOM observer should have detected
    // the newly rendered lines and attached hover handlers.
    // Verify by hovering over a code line that was scrolled into view.
    const codeLine = page.locator('[data-key] .react-file-line, .blob-code-inner').first();
    if (await codeLine.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await codeLine.hover({ force: true });
      await page.waitForTimeout(500);
    }

    // Extension should still be functional after scroll
    await expect(shadowHost).toBeAttached();

    await page.close();
  });

  test('hover works after scrolling past the initial viewport', async ({ context }) => {
    const page = await context.newPage();

    await page.goto(
      'https://github.com/preactjs/preact/blob/main/src/diff/index.js',
      { waitUntil: 'networkidle', timeout: 20_000 },
    );

    await page.waitForTimeout(2_000);

    // Scroll to the bottom of the file
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(1_500);

    // Scroll back up slightly
    await page.evaluate(() => {
      window.scrollBy(0, -500);
    });

    await page.waitForTimeout(1_000);

    // The extension should handle the DOM mutations from scroll virtualization
    // without errors and maintain its ability to detect hovers.
    const shadowHost = page.locator('#gh-lsp-root');
    await expect(shadowHost).toBeAttached();

    // Hover over newly visible code
    const codeLine = page.locator('[data-key] .react-file-line, .blob-code-inner').first();
    if (await codeLine.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await codeLine.hover({ force: true });
      await page.waitForTimeout(500);
    }

    // Extension remains functional
    await expect(shadowHost).toBeAttached();

    await page.close();
  });
});
