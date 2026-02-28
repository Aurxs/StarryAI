import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './app/global.css';

// 前端应用挂载入口：
// 将根组件挂载到 index.html 中的 #root 节点。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
