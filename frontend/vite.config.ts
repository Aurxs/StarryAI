import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 构建配置：
// 1) 启用 React 插件
// 2) 固定开发端口，避免团队成员本地端口随机变化
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
