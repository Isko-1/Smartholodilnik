import { useEffect, useState } from "react"
import { BorderBeam } from "./magicui/border-beam"

/**
 * Слушает событие `fridge:urgent` (products.js, renderStats) и подсвечивает
 * кнопку "Что приготовить?" бегущим бордером, когда в холодильнике есть
 * товары в статусе red. Монтируется в #cook-beam-root — отдельный узел
 * *внутри* существующей кнопки #cook-btn, а не поверх неё, чтобы не сносить
 * ванильный onClick-обработчик, который уже на неё повешен в main.js.
 */
export function CookBeam() {
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    const onUrgent = (e: Event) => setUrgent(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener("fridge:urgent", onUrgent)
    return () => window.removeEventListener("fridge:urgent", onUrgent)
  }, [])

  if (!urgent) return null

  return <BorderBeam size={70} duration={3} colorFrom="#BC4B34" colorTo="#D6A24C" />
}
