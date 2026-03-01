import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {App} from '../../src/app/App';

describe('App shell baseline', () => {
    it('renders persistence panel and run action', () => {
        render(<App/>);

        expect(screen.getByTestId('graph-persistence-panel')).toBeTruthy();
        expect(screen.getByTestId('project-name-display')).toBeTruthy();
        expect(screen.getByTestId('graph-panel-expand')).toBeTruthy();
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
