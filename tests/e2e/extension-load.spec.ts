import { test, expect } from './fixtures';

test.describe('Extension loading', () => {
  test('extension service worker is registered', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(0);
  });

  test('popup page renders', async ({ popupPage }) => {
    // The popup should render the gh-lsp title
    const title = popupPage.locator('.gh-lsp-popup__title');
    await expect(title).toHaveText('gh-lsp');
  });

  test('popup shows extension toggle', async ({ popupPage }) => {
    const toggle = popupPage.locator('input[type="checkbox"]');
    await expect(toggle).toBeVisible();
  });

  test('popup shows settings button', async ({ popupPage }) => {
    const settingsBtn = popupPage.locator('.gh-lsp-popup__options-btn');
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toHaveText('Settings');
  });

  test('options page renders', async ({ optionsPage }) => {
    const title = optionsPage.locator('.gh-lsp-options__title');
    await expect(title).toHaveText('gh-lsp Settings');
  });

  test('options page has display section', async ({ optionsPage }) => {
    const section = optionsPage.locator('section[aria-label="Display settings"]');
    await expect(section).toBeVisible();
  });

  test('options page has language section', async ({ optionsPage }) => {
    const section = optionsPage.locator('section[aria-label="Language settings"]');
    await expect(section).toBeVisible();
  });

  test('options page has authentication section', async ({ optionsPage }) => {
    const section = optionsPage.locator('section[aria-label="Authentication settings"]');
    await expect(section).toBeVisible();
  });

  test('options page has performance section', async ({ optionsPage }) => {
    const section = optionsPage.locator('section[aria-label="Performance settings"]');
    await expect(section).toBeVisible();
  });

  test('options page has theme section', async ({ optionsPage }) => {
    const section = optionsPage.locator('section[aria-label="Theme settings"]');
    await expect(section).toBeVisible();
  });
});
