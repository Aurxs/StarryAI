import { useMemo } from 'react';

export function App() {
  const phase = useMemo(() => 'Phase A: Backend protocol and graph modeling', []);

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>StarryAI Workbench</h1>
      <p>{phase}</p>
      <p>Frontend graph editor will be implemented in Phase E.</p>
    </main>
  );
}
