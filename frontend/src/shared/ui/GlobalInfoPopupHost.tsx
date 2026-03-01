import {useEffect, useState} from 'react';

import {clearGlobalInfoMessage, useGlobalInfoStore} from '../state/global-info-store';
import {InfoPopup} from './InfoPopup';

interface GlobalInfoPopupHostProps {
    right: number;
    top: number;
    stayMs?: number;
    exitMs?: number;
    ease?: string;
    extraTransition?: string;
    testId?: string;
    zIndex?: number;
}

const DEFAULT_STAY_MS = 5000;
const DEFAULT_EXIT_MS = 260;
const DEFAULT_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function GlobalInfoPopupHost({
    right,
    top,
    stayMs = DEFAULT_STAY_MS,
    exitMs = DEFAULT_EXIT_MS,
    ease = DEFAULT_EASE,
    extraTransition,
    testId = 'global-info-popup',
    zIndex = 11,
}: GlobalInfoPopupHostProps) {
    const message = useGlobalInfoStore((state) => state.message);
    const messageSeq = useGlobalInfoStore((state) => state.messageSeq);
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        if (!message) {
            setLeaving(false);
            return;
        }
        setLeaving(false);
        const leaveTimer = window.setTimeout(() => {
            setLeaving(true);
        }, stayMs);
        const clearTimer = window.setTimeout(() => {
            clearGlobalInfoMessage();
            setLeaving(false);
        }, stayMs + exitMs);
        return () => {
            window.clearTimeout(leaveTimer);
            window.clearTimeout(clearTimer);
        };
    }, [exitMs, message, messageSeq, stayMs]);

    if (!message) {
        return null;
    }

    return (
        <InfoPopup
            message={message}
            leaving={leaving}
            right={right}
            top={top}
            zIndex={zIndex}
            exitMs={exitMs}
            ease={ease}
            extraTransition={extraTransition}
            testId={testId}
        />
    );
}

