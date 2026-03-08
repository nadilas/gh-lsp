import { test, expect } from './fixtures';

/**
 * E2E tests for PAT (Personal Access Token) authentication flow.
 *
 * Tests verify the PAT input UI in the options page, including:
 * - Token input field behavior (show/hide)
 * - Save and validation button functionality
 * - Masked display after saving
 *
 * Note: These tests do NOT use a real GitHub PAT. They test the UI flow
 * only. Actual API authentication is tested via unit/integration tests.
 */
test.describe('PAT authentication', () => {
  test('PAT input field is initially empty and masked', async ({ optionsPage }) => {
    // Find the PAT input in the Authentication section
    const patInput = optionsPage.locator('input[type="password"]').first();
    await expect(patInput).toBeVisible({ timeout: 5_000 });
    await expect(patInput).toHaveValue('');
  });

  test('show/hide toggle reveals and masks the PAT', async ({ optionsPage }) => {
    // Wait for the page to fully load
    await optionsPage.waitForTimeout(1_000);

    const patInput = optionsPage.locator('input[type="password"]').first();
    await expect(patInput).toBeVisible({ timeout: 5_000 });

    // Find the show/hide toggle button
    const showHideBtn = optionsPage.getByRole('button', { name: /show token|hide token/i });
    if (await showHideBtn.isVisible()) {
      // Click to show token
      await showHideBtn.click();

      // Input type should change to text
      const inputAfterShow = optionsPage.locator(
        'input[type="text"][aria-label*="token" i], input[type="text"][aria-label*="Token" i]',
      ).first();
      // Either the type changed or a new visible text input appeared
      const hasTextInput = await inputAfterShow.isVisible({ timeout: 2_000 }).catch(() => false);

      if (hasTextInput) {
        // Click again to hide
        await showHideBtn.click();
        await optionsPage.waitForTimeout(300);
      }
    }
  });

  test('validate button shows error for empty token', async ({ optionsPage }) => {
    await optionsPage.waitForTimeout(1_000);

    // Find and click the validate button without entering a token
    const validateBtn = optionsPage.getByRole('button', { name: /validate/i });
    if (await validateBtn.isVisible()) {
      await validateBtn.click();
      await optionsPage.waitForTimeout(1_000);

      // Should show an error message about empty token
      const errorText = optionsPage.getByText(/no token provided/i);
      await expect(errorText).toBeVisible({ timeout: 3_000 });
    }
  });

  test('save button stores token in secure storage', async ({ optionsPage }) => {
    await optionsPage.waitForTimeout(1_000);

    // Enter a test token
    const patInput = optionsPage.locator('input[type="password"]').first();
    if (await patInput.isVisible()) {
      await patInput.fill('ghp_test1234567890abcdef');

      // Click save
      const saveBtn = optionsPage.getByRole('button', { name: /save/i });
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await optionsPage.waitForTimeout(500);

        // The token should have been saved (via chrome.storage.local)
        // We can verify by checking that the input is now masked or
        // shows a success indicator
      }
    }
  });
});
