import { useEffect, useState } from "react"
import { NumberTicker } from "./magicui/number-ticker"

type Counts = { red: number; yellow: number; green: number; overdue: number }

// Цвета — те же токены, что и STATUS_META в categories.js, чтобы плашки
// совпадали по смыслу с полосками статуса на карточках продуктов.
const CARDS: { key: keyof Omit<Counts, "overdue">; label: string; color: string }[] = [
  { key: "green", label: "Свежие", color: "#059669" },
  { key: "yellow", label: "Срок подходит", color: "#D6A24C" },
  { key: "red", label: "Съесть срочно", color: "#BC4B34" },
]

/**
 * Слушает событие `fridge:stats`, которое диспатчит products.js (renderStats)
 * на каждый render() — ванильный код ничего не знает про React, просто кидает
 * CustomEvent с готовыми счётчиками.
 */
export function StatsTicker() {
  const [counts, setCounts] = useState<Counts>({ red: 0, yellow: 0, green: 0, overdue: 0 })

  useEffect(() => {
    const onStats = (e: Event) => setCounts((e as CustomEvent<Counts>).detail)
    window.addEventListener("fridge:stats", onStats)
    return () => window.removeEventListener("fridge:stats", onStats)
  }, [])

  return (
    <>
      {CARDS.map((card) => (
        <div key={card.key} className="bg-white/70 border border-bone-dark rounded-2xl p-3.5 text-center">
          <p className="font-display font-semibold text-2xl" style={{ color: card.color }}>
            <NumberTicker value={counts[card.key]} />
          </p>
          <p className="text-[11px] text-navy/50 mt-0.5">{card.label}</p>
          <p className="mt-1.5 h-5 flex items-center justify-center">
            {card.key === "red" && counts.overdue > 0 && (
              <span className="card-urgent-glow inline-block bg-[#BC4B34]/15 text-[#8f3623] rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold whitespace-nowrap">
                {counts.overdue} просрочено
              </span>
            )}
          </p>
        </div>
      ))}
    </>
  )
}
