import {useEffect, useMemo, useRef, useState} from 'react';

import {removeGlobalInfoMessageById, useGlobalInfoStore} from '../state/global-info-store';
import {InfoPopup} from './InfoPopup';

interface GlobalInfoPopupHostProps {
    stayMs?: number;
    exitMs?: number;
    ease?: string;
    testId?: string;
}

const DEFAULT_STAY_MS = 5000;
const DEFAULT_EXIT_MS = 260;
const DEFAULT_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function GlobalInfoPopupHost({
    stayMs = DEFAULT_STAY_MS,
    exitMs = DEFAULT_EXIT_MS,
    ease = DEFAULT_EASE,
    testId = 'global-info-popup',
}: GlobalInfoPopupHostProps) {
    const messages = useGlobalInfoStore((state) => state.messages);
    const [leavingIds, setLeavingIds] = useState<Set<number>>(() => new Set());
    const [enteredIds, setEnteredIds] = useState<Set<number>>(() => new Set());
    const timerMapRef = useRef<Map<number, {leaveTimer: number; removeTimer: number}>>(new Map());
    const enterRafMapRef = useRef<Map<number, number>>(new Map());
    const knownIdsRef = useRef<Set<number>>(new Set());
    const displayMessages = useMemo(
        () => [...messages].sort((a, b) => b.id - a.id),
        [messages],
    );

    useEffect(() => {
        const activeIds = new Set(messages.map((message) => message.id));
        const timerMap = timerMapRef.current;
        for (const [id, timers] of timerMap.entries()) {
            if (activeIds.has(id)) {
                continue;
            }
            window.clearTimeout(timers.leaveTimer);
            window.clearTimeout(timers.removeTimer);
            timerMap.delete(id);
            knownIdsRef.current.delete(id);
        }
        const enterRafMap = enterRafMapRef.current;
        for (const [id, rafId] of enterRafMap.entries()) {
            if (activeIds.has(id)) {
                continue;
            }
            window.cancelAnimationFrame(rafId);
            enterRafMap.delete(id);
            knownIdsRef.current.delete(id);
        }
        setLeavingIds((prev) => {
            let changed = false;
            const next = new Set<number>();
            for (const id of prev) {
                if (activeIds.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
        setEnteredIds((prev) => {
            let changed = false;
            const next = new Set<number>();
            for (const id of prev) {
                if (activeIds.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });

        for (const message of messages) {
            const messageId = message.id;
            if (!timerMap.has(messageId)) {
                const leaveTimer = window.setTimeout(() => {
                    setLeavingIds((prev) => {
                        if (prev.has(messageId)) {
                            return prev;
                        }
                        const next = new Set(prev);
                        next.add(messageId);
                        return next;
                    });
                }, stayMs);
                const removeTimer = window.setTimeout(() => {
                    removeGlobalInfoMessageById(messageId);
                    setLeavingIds((prev) => {
                        if (!prev.has(messageId)) {
                            return prev;
                        }
                        const next = new Set(prev);
                        next.delete(messageId);
                        return next;
                    });
                    setEnteredIds((prev) => {
                        if (!prev.has(messageId)) {
                            return prev;
                        }
                        const next = new Set(prev);
                        next.delete(messageId);
                        return next;
                    });
                    timerMap.delete(messageId);
                    knownIdsRef.current.delete(messageId);
                }, stayMs + exitMs);
                timerMap.set(messageId, {leaveTimer, removeTimer});
            }
            if (knownIdsRef.current.has(messageId) || enterRafMap.has(messageId)) {
                continue;
            }
            knownIdsRef.current.add(messageId);
            const rafId = window.requestAnimationFrame(() => {
                setEnteredIds((prev) => {
                    if (prev.has(messageId)) {
                        return prev;
                    }
                    const next = new Set(prev);
                    next.add(messageId);
                    return next;
                });
                enterRafMap.delete(messageId);
            });
            enterRafMap.set(messageId, rafId);
        }
    }, [exitMs, messages, stayMs]);

    useEffect(() => () => {
        for (const {leaveTimer, removeTimer} of timerMapRef.current.values()) {
            window.clearTimeout(leaveTimer);
            window.clearTimeout(removeTimer);
        }
        timerMapRef.current.clear();
        for (const rafId of enterRafMapRef.current.values()) {
            window.cancelAnimationFrame(rafId);
        }
        enterRafMapRef.current.clear();
        knownIdsRef.current.clear();
    }, []);

    if (displayMessages.length === 0) {
        return null;
    }

    return (
        <div style={{display: 'grid', gap: 8}}>
            {displayMessages.map((message, index) => {
                const leaving = leavingIds.has(message.id);
                const entered = enteredIds.has(message.id);
                const expanded = entered && !leaving;
                return (
                    <div
                        key={message.id}
                        style={{
                            display: 'grid',
                            gridTemplateRows: expanded ? '1fr' : '0fr',
                            opacity: expanded ? 1 : 0,
                            transform: expanded ? 'translateY(0)' : 'translateY(-12px)',
                            transition: `grid-template-rows ${exitMs}ms ${ease}, opacity ${exitMs}ms ${ease}, transform ${exitMs}ms ${ease}`,
                        }}
                    >
                        <div style={{minHeight: 0, overflow: 'hidden'}}>
                            <InfoPopup
                                message={message.message}
                                level={message.level}
                                leaving={leaving}
                                exitMs={exitMs}
                                ease={ease}
                                testId={index === 0 ? testId : `${testId}-${message.id}`}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
