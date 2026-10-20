import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserApi } from './browser-api'
import './styles.css'

// Electron 下有 preload 注入的 window.mc；浏览器模式下自动装 HTTP 适配层
installBrowserApi()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
