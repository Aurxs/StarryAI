import {expect, test} from '@playwright/test';

test('shows new workbench shell controls', async ({page}) => {
    await page.goto('/');

    await expect(page.getByRole('button', {name: '当前项目名称 ↓'})).toBeVisible();
    await expect(page.getByRole('button', {name: '▶ 测试运行'})).toBeVisible();
    await expect(page.getByTestId('review-bar')).toBeVisible();
    await expect(page.getByLabel('quick-tools')).toBeVisible();
});

test('switches language from project menu and keeps selection after reload', async ({page}) => {
    await page.goto('/');

    await page.getByRole('button', {name: '当前项目名称 ↓'}).click();
    await page.getByTestId('language-switch').selectOption('en-US');
    await expect(page.getByRole('button', {name: '▶ Run Test'})).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', {name: '▶ Run Test'})).toBeVisible();
});
