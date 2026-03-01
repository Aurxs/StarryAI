import type {CSSProperties} from 'react';

interface InfoPopupProps {
    message: string;
    leaving: boolean;
    right: number;
    top: number;
    exitMs: number;
    ease: string;
    testId?: string;
    zIndex?: number;
    maxWidth?: number;
    extraTransition?: string;
}

export function InfoPopup({
    message,
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
    const baseTransition = `transform ${exitMs}ms ${ease}, opacity ${exitMs}ms ${ease}`;
    const transition = extraTransition ? `${baseTransition}, ${extraTransition}` : baseTransition;

    const popupStyle: CSSProperties = {
        position: 'absolute',
        right,
        top,
        zIndex,
        padding: '9px 12px',
        borderRadius: 12,
        border: '1px solid #dce3ee',
        boxShadow: '0 12px 22px rgba(15, 23, 42, 0.08)',
        background: 'rgba(255, 255, 255, 0.96)',
        color: '#334155',
        fontSize: 12,
        lineHeight: 1.45,
        maxWidth,
        transform: leaving ? 'translateX(28px)' : 'translateX(0)',
        opacity: leaving ? 0 : 1,
        transition,
        pointerEvents: 'none',
    };

    return (
        <div style={popupStyle}>
            <span data-testid={testId}>{message}</span>
        </div>
    );
}

