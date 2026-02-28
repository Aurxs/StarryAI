import {expect, test} from '@playwright/test';

test('shows workbench heading and Phase E handoff text', async ({page}) => {
    await page.goto('/');

    await expect(page.getByRole('heading', {name: 'StarryAI Workbench'})).toBeVisible();
    await expect(page.getByText('Phase E / T2 baseline shell')).toBeVisible();
});

test('keeps root render stable on reload (edge path)', async ({page}) => {
    await page.goto('/');
    await page.reload();

    await expect(page.getByRole('heading', {name: 'StarryAI Workbench'})).toBeVisible();
});
