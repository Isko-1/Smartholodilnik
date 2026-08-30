import { useEffect, useState } from "react";
import { BorderBeam } from "./magicui/border-beam";

/**
 * Подсветка по контуру кнопки "Что приготовить?" — включается, когда в
 * холодильнике есть срочные (red) продукты. products.js дёргает
 * window.dispatchEvent(new CustomEvent("fridge:urgent", { detail: boolean })).
 */
export function CookBeam() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onUrgent = (e: Event) => setActive(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("fridge:urgent", onUrgent);
    return () => window.removeEventListener("fridge:urgent", onUrgent);
  }, []);

  if (!active) return null;

  return <BorderBeam size={40} duration={2.4} colorFrom="#D6A24C" colorTo="#BC4B34" />;
}
