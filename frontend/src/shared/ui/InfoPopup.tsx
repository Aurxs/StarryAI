import type {CSSProperties} from 'react';

import type {GlobalInfoLevel} from '../state/global-info-store';

interface InfoPopupProps {
    message: string;
    level?: GlobalInfoLevel;
    leaving: boolean;
    right?: number;
    top?: number;
    exitMs: number;
    ease: string;
    testId?: string;
    zIndex?: number;
    maxWidth?: number;
    extraTransition?: string;
}

export function InfoPopup({
    message,
    level = 'info',
    leaving,
    right,
    top,
    exitMs,
    ease,
    testId,
    zIndex = 6,
    maxWidth = 360,
    extraTransition,
}: InfoPopupProps) {
    const palette: Record<GlobalInfoLevel, {border: string; text: string; accent: string}> = {
        info: {
            border: '#dce3ee',
            text: '#334155',
            accent: '#2563eb',
        },
        success: {
            border: '#bbf7d0',
            text: '#166534',
            accent: '#16a34a',
        },
        warning: {
            border: '#fde68a',
            text: '#92400e',
            accent: '#d97706',
        },
        error: {
            border: '#fecaca',
            text: '#991b1b',
            accent: '#dc2626',
        },
    };
    const theme = palette[level];
    const baseTransition = `transform ${exitMs}ms ${ease}, opacity ${exitMs}ms ${ease}`;
    const transition = extraTransition ? `${baseTransition}, ${extraTransition}` : baseTransition;
    const isAbsoluteMode = typeof right === 'number' && typeof top === 'number';

    const popupStyle: CSSProperties = {
        width: isAbsoluteMode ? undefined : '100%',
        position: isAbsoluteMode ? 'absolute' : 'relative',
        right,
        top,
        zIndex,
        maxWidth: isAbsoluteMode ? maxWidth : undefined,
        padding: isAbsoluteMode ? '9px 12px' : '9px 12px 9px 14px',
        borderRadius: 12,
        border: `1px solid ${theme.border}`,
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
        background: isAbsoluteMode ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.95)',
        color: theme.text,
        fontSize: 12,
        lineHeight: 1.45,
        transform: leaving
            ? isAbsoluteMode
                ? 'translateX(28px)'
                : 'translateY(-6px)'
            : isAbsoluteMode
                ? 'translateX(0)'
                : 'translateY(0)',
        opacity: leaving ? 0 : 1,
        transition,
        pointerEvents: 'none',
        overflow: 'hidden',
    };

    return (
        <div style={popupStyle} data-testid={testId}>
            {!isAbsoluteMode && (
                <span
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        background: theme.accent,
                    }}
                    aria-hidden="true"
                />
            )}
            <span>{message}</span>
        </div>
    );
}
