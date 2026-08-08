import './index.css';
import { createRoot } from 'react-dom/client';
import { StatsTicker } from './components/StatsTicker';
import { CookBeam } from './components/CookBeam';

// #stats-ticker-root и #cook-beam-root уже размечены в index.html —
// это два независимых React-острова поверх ванильного main.js/products.js,
// связь только через CustomEvent'ы fridge:stats / fridge:urgent (см. products.js, renderStats).
const statsRoot = document.getElementById('stats-ticker-root');
if (statsRoot) createRoot(statsRoot).render(<StatsTicker />);

const beamRoot = document.getElementById('cook-beam-root');
if (beamRoot) createRoot(beamRoot).render(<CookBeam />);
