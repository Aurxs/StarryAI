import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {App} from '../../src/app/App';

describe('App shell baseline', () => {
    it('renders workbench heading and shell marker', () => {
        render(<App/>);

        const heading = screen.getByRole('heading', {
            level: 1,
            name: 'StarryAI 工作台',
        });
        const phaseText = screen.getByText('Phase E / T2 基线框架');

        expect(heading).toBeTruthy();
        expect(phaseText).toBeTruthy();
    });

    it('shows runtime console section', () => {
        render(<App/>);

        const runtimeConsole = screen.getByRole('heading', {level: 2, name: '运行控制台'});
        expect(runtimeConsole).toBeTruthy();
    });
});
