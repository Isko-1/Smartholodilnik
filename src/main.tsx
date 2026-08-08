import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ShineBorder } from '@/components/magicui/shine-border'

const rootElement = document.getElementById('react-auth-shine')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="relative flex h-[100px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border bg-background md:shadow-xl">
        <ShineBorder color={["#A07CFE", "#FE8FB5", "#FFBE7B"]}>
          <span className="pointer-events-none whitespace-pre-wrap bg-gradient-to-b from-black to-gray-300 bg-clip-text text-center text-xl font-semibold leading-none text-transparent dark:from-white dark:to-slate-900">
            React-остров с Shine Border работает!
          </span>
        </ShineBorder>
      </div>
    </React.StrictMode>
  )
}