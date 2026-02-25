import { useMemo } from 'react';

export function App() {
    // 当前阶段展示标识文本，后续将替换为完整工作台布局。
  const phase = useMemo(() => 'Phase A: Backend protocol and graph modeling', []);

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>StarryAI Workbench</h1>
      <p>{phase}</p>
      <p>Frontend graph editor will be implemented in Phase E.</p>
    </main>
  );
}
