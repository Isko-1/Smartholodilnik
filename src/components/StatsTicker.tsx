import { useEffect, useState } from "react";
import { NumberTicker } from "./magicui/number-ticker";

interface StatCounts {
  red: number;
  yellow: number;
  green: number;
}

/**
 * products.js (ванильный код) не знает и не должен знать про React — он
 * просто делает window.dispatchEvent(new CustomEvent("fridge:stats", { detail: counts }))
 * при каждом render(). Этот компонент слушает событие и анимирует цифры.
 */
export function StatsTicker() {
  const [counts, setCounts] = useState<StatCounts>({ red: 0, yellow: 0, green: 0 });

  useEffect(() => {
    const onStats = (e: Event) => setCounts((e as CustomEvent<StatCounts>).detail);
    window.addEventListener("fridge:stats", onStats);
    return () => window.removeEventListener("fridge:stats", onStats);
  }, []);

  return (
    <>
      <div className="bg-white/70 border border-bone-dark rounded-2xl p-3.5 text-center">
        <NumberTicker value={counts.red} className="font-mono text-2xl font-semibold text-terracotta" />
        <p className="text-xs text-navy/50 mt-0.5">Съесть срочно</p>
      </div>
      <div className="bg-white/70 border border-bone-dark rounded-2xl p-3.5 text-center">
        <NumberTicker value={counts.yellow} className="font-mono text-2xl font-semibold text-amber" />
        <p className="text-xs text-navy/50 mt-0.5">Скоро истечёт</p>
      </div>
      <div className="bg-white/70 border border-bone-dark rounded-2xl p-3.5 text-center">
        <NumberTicker value={counts.green} className="font-mono text-2xl font-semibold text-sage" />
        <p className="text-xs text-navy/50 mt-0.5">Свежие</p>
      </div>
    </>
  );
}
