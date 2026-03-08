import { test, expect } from './fixtures';

test.describe('Options page', () => {
  test('can switch display mode to sidebar', async ({ optionsPage }) => {
    const sidebarRadio = optionsPage.locator('input[type="radio"][value="sidebar"]');
    const popoverRadio = optionsPage.locator('input[type="radio"][value="popover"]');

    // Default should be popover
    await expect(popoverRadio).toBeChecked();
    await expect(sidebarRadio).not.toBeChecked();

    // Switch to sidebar
    await sidebarRadio.click();
    await expect(sidebarRadio).toBeChecked();
    await expect(popoverRadio).not.toBeChecked();

    // Switch back to popover
    await popoverRadio.click();
    await expect(popoverRadio).toBeChecked();
  });

  test('can change sidebar position', async ({ optionsPage }) => {
    const select = optionsPage.locator('.gh-lsp-options__select');
    await expect(select).toBeVisible();

    // Default should be 'right'
    await expect(select).toHaveValue('right');

    // Change to 'left'
    await select.selectOption('left');
    await expect(select).toHaveValue('left');

    // Change back to 'right'
    await select.selectOption('right');
    await expect(select).toHaveValue('right');
  });

  test('can toggle language checkboxes', async ({ optionsPage }) => {
    const tsCheckbox = optionsPage.locator(
      'section[aria-label="Language settings"] input[type="checkbox"]',
    ).first();

    // TypeScript should be checked by default
    await expect(tsCheckbox).toBeChecked();

    // Uncheck it
    await tsCheckbox.click();
    await expect(tsCheckbox).not.toBeChecked();

    // Re-check it
    await tsCheckbox.click();
    await expect(tsCheckbox).toBeChecked();
  });

  test('PAT input is a password field by default', async ({ optionsPage }) => {
    const patInput = optionsPage.locator(
      'input[aria-label="GitHub Personal Access Token"]',
    );
    await expect(patInput).toBeVisible();
    await expect(patInput).toHaveAttribute('type', 'password');
  });

  test('show/hide token button toggles PAT visibility', async ({ optionsPage }) => {
    const patInput = optionsPage.locator(
      'input[aria-label="GitHub Personal Access Token"]',
    );
    const showBtn = optionsPage.locator('button[aria-label="Show token"]');

    // Should start as password
    await expect(patInput).toHaveAttribute('type', 'password');

    // Click show
    await showBtn.click();
    await expect(patInput).toHaveAttribute('type', 'text');

    // Click hide
    const hideBtn = optionsPage.locator('button[aria-label="Hide token"]');
    await hideBtn.click();
    await expect(patInput).toHaveAttribute('type', 'password');
  });

  test('performance sliders are visible and interactive', async ({ optionsPage }) => {
    const debounceSlider = optionsPage.locator('input[aria-label="Hover debounce"]');
    await expect(debounceSlider).toBeVisible();
    await expect(debounceSlider).toHaveAttribute('type', 'range');

    const cacheTtlSlider = optionsPage.locator('input[aria-label="Cache TTL"]');
    await expect(cacheTtlSlider).toBeVisible();

    const workerIdleSlider = optionsPage.locator('input[aria-label="Worker idle timeout"]');
    await expect(workerIdleSlider).toBeVisible();

    const maxWorkersSlider = optionsPage.locator('input[aria-label="Max concurrent workers"]');
    await expect(maxWorkersSlider).toBeVisible();
  });

  test('theme radio buttons work', async ({ optionsPage }) => {
    const autoRadio = optionsPage.locator('input[type="radio"][value="auto"]');
    const lightRadio = optionsPage.locator('input[type="radio"][value="light"]');
    const darkRadio = optionsPage.locator('input[type="radio"][value="dark"]');

    // Default should be auto
    await expect(autoRadio).toBeChecked();

    // Switch to dark
    await darkRadio.click();
    await expect(darkRadio).toBeChecked();
    await expect(autoRadio).not.toBeChecked();

    // Switch to light
    await lightRadio.click();
    await expect(lightRadio).toBeChecked();
    await expect(darkRadio).not.toBeChecked();

    // Switch back to auto
    await autoRadio.click();
    await expect(autoRadio).toBeChecked();
  });

  test('about section shows version and source link', async ({ optionsPage }) => {
    const aboutSection = optionsPage.locator('section[aria-label="About"]');
    await expect(aboutSection).toBeVisible();

    const versionText = aboutSection.locator('.gh-lsp-options__about-row').first();
    await expect(versionText).toContainText('Version');
    await expect(versionText).toContainText('0.1.0');

    const sourceLink = aboutSection.locator('a.gh-lsp-options__about-link');
    await expect(sourceLink).toHaveAttribute('href', 'https://github.com/nadilas/gh-lsp');
  });
});
