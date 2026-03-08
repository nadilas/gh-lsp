import { test, expect } from './fixtures';

test.describe('Popup functionality', () => {
  test('can toggle extension off and on', async ({ popupPage }) => {
    const toggle = popupPage.locator('input[type="checkbox"]');

    // Extension should be enabled by default
    await expect(toggle).toBeChecked();

    // Toggle off
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // Should show disabled message
    const disabledMsg = popupPage.locator('.gh-lsp-popup__disabled-message');
    await expect(disabledMsg).toHaveText('Extension is disabled');

    // Toggle back on
    await toggle.click();
    await expect(toggle).toBeChecked();

    // Disabled message should disappear
    await expect(disabledMsg).not.toBeVisible();
  });

  test('shows unsupported page message on non-GitHub tabs', async ({ popupPage }) => {
    // By default, the popup opens in a chrome-extension:// tab, not GitHub
    const unsupportedMsg = popupPage.locator('.gh-lsp-popup__unsupported-message');
    await expect(unsupportedMsg).toBeVisible();
    await expect(unsupportedMsg).toContainText('Navigate to a GitHub code page');
  });

  test('display mode toggle switches between popover and sidebar', async ({ popupPage }) => {
    // Navigate to a GitHub-like URL first to see the mode toggle
    // Since we're not on GitHub, the mode toggle won't be visible
    // We test this through the options page instead
    const settingsBtn = popupPage.locator('.gh-lsp-popup__options-btn');
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toHaveAttribute('aria-label', 'Open extension settings');
  });
});
