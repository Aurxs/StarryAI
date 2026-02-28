import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {App} from '../../src/app/App';

describe('App shell baseline', () => {
    it('renders workbench heading and shell marker', () => {
        render(<App/>);

        const heading = screen.getByRole('heading', {
            level: 1,
            name: 'StarryAI Workbench',
        });
        const phaseText = screen.getByText('Phase E / T2 baseline shell');

        expect(heading).toBeTruthy();
        expect(phaseText).toBeTruthy();
    });

    it('shows runtime console section', () => {
        render(<App/>);

        const runtimeConsole = screen.getByRole('heading', {level: 2, name: 'Runtime Console'});
        expect(runtimeConsole).toBeTruthy();
    });
});
