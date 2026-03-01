import {expect, test} from '@playwright/test';

test('shows new workbench shell controls', async ({page}) => {
    await page.goto('/');

    await expect(page.getByTestId('graph-persistence-panel')).toBeVisible();
    await expect(page.getByTestId('project-name-display')).toBeVisible();
    await expect(page.getByTestId('graph-panel-expand')).toBeVisible();
    await expect(page.getByRole('button', {name: '▶ 测试运行'})).toBeVisible();
    await expect(page.getByTestId('review-bar')).toBeVisible();
    await expect(page.getByLabel('quick-tools')).toBeVisible();
});

test('expands and collapses graph panel', async ({page}) => {
    await page.goto('/');

    await page.getByTestId('graph-panel-expand').click();
    await expect(page.getByRole('button', {name: '保存'})).toBeVisible();
    await page.getByTestId('graph-panel-collapse').click();
    await expect(page.getByTestId('graph-panel-expand')).toBeVisible();
});
