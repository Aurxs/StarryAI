import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {SettingsDialog} from '../../src/features/settings/SettingsDialog';

describe('SettingsDialog', () => {
    it('keeps padding inside the scroll container so focused controls are not clipped', () => {
        render(
            <SettingsDialog
                open
                currentLanguage="zh-CN"
                onClose={() => undefined}
                onLanguageChange={() => undefined}
            />,
        );

        const content = screen.getByTestId('settings-dialog-content') as HTMLDivElement;
        expect(content.style.overflow).toBe('auto');
        expect(content.style.padding).toBe('4px');
    });
});
