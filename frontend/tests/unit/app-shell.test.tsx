import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {App} from '../../src/app/App';

describe('App shell baseline', () => {
    it('renders project switcher and run action', () => {
        render(<App/>);

        expect(screen.getByRole('button', {name: '当前项目名称 ↓'})).toBeTruthy();
        expect(screen.getByRole('button', {name: '▶ 测试运行'})).toBeTruthy();
        expect(screen.getByTestId('review-bar')).toBeTruthy();
    });

    it('keeps quick tool rail visible on canvas', () => {
        render(<App/>);

        expect(screen.getByLabelText('quick-tools')).toBeTruthy();
        expect(screen.getByRole('button', {name: '↖'})).toBeTruthy();
        expect(screen.getByRole('button', {name: '✋'})).toBeTruthy();
    });
});
