import React from "react"

interface ShineBorderProps {
  borderRadius?: number
  borderWidth?: number
  duration?: number
  color?: string | string[]
  className?: string
  children: React.ReactNode
}

export function ShineBorder({
  children,
  color = "#A07CFE",
}: ShineBorderProps) {
  return (
    <div style={{ position: 'relative', padding: '1rem', border: '2px solid', borderColor: Array.isArray(color) ? color[0] : color, borderRadius: '8px' }}>
      {children}
    </div>
  )
}