import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ShineBorder } from '@/components/magicui/shine-border'

const rootElement = document.getElementById('react-auth-shine')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ShineBorder color={["#A07CFE", "#FE8FB5", "#FFBE7B"]}>
        {/* Здесь ваш UI или содержимое */}
      </ShineBorder>
    </React.StrictMode>
  )
}
