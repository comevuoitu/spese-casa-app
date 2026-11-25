// Illustrations used across the app (inline SVG, colors fixed so they read on light and dark tiles)
window.ART = {
  casa: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="18" y="20" width="64" height="70" rx="4" fill="#5b8fd6"/>
    <rect x="18" y="14" width="64" height="9" rx="3" fill="#3f6fb5"/>
    ${[0,1,2,3,4,5].map(r => [0,1,2].map(c => {
      const lit = (r === 0 && c === 2);
      return `<rect x="${26 + c * 19}" y="${27 + r * 10}" width="11" height="6" rx="1.5" fill="${lit ? '#ffd34d' : '#cfe1fb'}"/>`;
    }).join('')).join('')}
    <rect x="44" y="80" width="12" height="10" rx="2" fill="#2d4f86"/>
    <rect x="86" y="44" width="22" height="46" rx="3" fill="#8db5ea"/>
    ${[0,1,2,3].map(r => `<rect x="91" y="${50 + r * 9}" width="12" height="5" rx="1.5" fill="#e3eefc"/>`).join('')}
    <circle cx="100" cy="18" r="8" fill="#ffd34d"/>
    <rect x="6" y="89" width="108" height="4" rx="2" fill="#9bb7d9"/>
  </svg>`,
  box: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <path d="M14 38 L60 14 L106 38 V90 H14 Z" fill="#7a86a8"/>
    <path d="M10 40 L60 13 L110 40" fill="none" stroke="#4c5675" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="26" y="46" width="68" height="44" rx="3" fill="#dfe3ef"/>
    ${[0,1,2,3,4,5].map(i => `<rect x="28" y="${49 + i * 7}" width="64" height="3" rx="1" fill="#b9c0d6"/>`).join('')}
    <rect x="96" y="56" width="10" height="14" rx="2" fill="#27c38a"/>
    <path d="M101 59 l-2.5 4.5 h3 l-2.5 4.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="6" y="89" width="108" height="4" rx="2" fill="#a9b1c8"/>
  </svg>`,
  luce: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <circle cx="92" cy="22" r="12" fill="#f5b82e"/>
    ${[0,45,90,135,180,225,270,315].map(a => {
      const r1 = 16, r2 = 21, x = 92, y = 22, rad = a * Math.PI / 180;
      return `<line x1="${x + r1 * Math.cos(rad)}" y1="${y + r1 * Math.sin(rad)}" x2="${x + r2 * Math.cos(rad)}" y2="${y + r2 * Math.sin(rad)}" stroke="#f5b82e" stroke-width="3" stroke-linecap="round"/>`;
    }).join('')}
    <path d="M14 70 L34 36 H94 L80 70 Z" fill="#2d5fae"/>
    <path d="M34 36 L14 70 M54 36 L39 70 M74 36 L64 70 M24.5 52 H87 " stroke="#9cc3ff" stroke-width="2"/>
    <rect x="50" y="70" width="6" height="16" fill="#7c8796"/>
    <rect x="36" y="85" width="34" height="5" rx="2.5" fill="#7c8796"/>
  </svg>`,
  gas: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="12" y="58" width="96" height="30" rx="6" fill="#4a5361"/>
    <rect x="12" y="52" width="96" height="10" rx="4" fill="#6b7585"/>
    <circle cx="34" cy="74" r="5" fill="#c9d0db"/><circle cx="60" cy="74" r="5" fill="#c9d0db"/><circle cx="86" cy="74" r="5" fill="#c9d0db"/>
    <ellipse cx="60" cy="52" rx="24" ry="5" fill="#2d333d"/>
    <path d="M60 18 C70 30 74 36 70 46 C68 51 64 53 60 53 C56 53 52 51 50 46 C47 38 53 32 56 26 C57 32 60 34 62 33 C64 28 62 24 60 18 Z" fill="#3a7bff"/>
    <path d="M60 32 C65 39 66 43 64 47 C63 50 61 51 60 51 C58 51 56 50 55.5 47.5 C54.5 44 57 41 58.5 38 C59 41 60.5 42 61.5 41.5 C62 39 61 36 60 32 Z" fill="#9fd0ff"/>
  </svg>`,
  net: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <path d="M38 40 a30 30 0 0 1 44 0" fill="none" stroke="#25a37a" stroke-width="5" stroke-linecap="round"/>
    <path d="M30 30 a42 42 0 0 1 60 0" fill="none" stroke="#25a37a" stroke-width="5" stroke-linecap="round" opacity=".6"/>
    <path d="M46 50 a18 18 0 0 1 28 0" fill="none" stroke="#25a37a" stroke-width="5" stroke-linecap="round"/>
    <rect x="22" y="60" width="76" height="24" rx="8" fill="#2c3e50"/>
    <circle cx="36" cy="72" r="3" fill="#3cf0a6"/><circle cx="47" cy="72" r="3" fill="#3cf0a6"/><circle cx="58" cy="72" r="3" fill="#f5b82e"/>
    <rect x="70" y="69" width="20" height="6" rx="3" fill="#5c7087"/>
    <rect x="30" y="84" width="8" height="6" rx="2" fill="#2c3e50"/><rect x="82" y="84" width="8" height="6" rx="2" fill="#2c3e50"/>
  </svg>`,
  ask: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <path d="M22 18 H98 a10 10 0 0 1 10 10 V60 a10 10 0 0 1 -10 10 H54 L36 84 V70 H22 a10 10 0 0 1 -10 -10 V28 a10 10 0 0 1 10 -10 Z" fill="#7b5cd6"/>
    <path d="M52 36 a8 8 0 1 1 11 7.4 c-2.4 1 -3 2.6 -3 4.6 v1.5" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <circle cx="60" cy="59" r="3.2" fill="#fff"/>
  </svg>`,
  tasse: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="30" y="10" width="56" height="74" rx="6" fill="#ffffff" stroke="#6f9a62" stroke-width="3"/>
    <rect x="40" y="22" width="36" height="5" rx="2.5" fill="#b8d3ae"/><rect x="40" y="33" width="28" height="5" rx="2.5" fill="#b8d3ae"/><rect x="40" y="44" width="32" height="5" rx="2.5" fill="#b8d3ae"/>
    <circle cx="80" cy="66" r="18" fill="#4f8a3f"/>
    <text x="80" y="73" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#fff">€</text>
  </svg>`,
  lavori: `<svg viewBox="0 0 120 96" aria-hidden="true">
    <rect x="16" y="44" width="88" height="40" rx="7" fill="#e07b39"/>
    <rect x="16" y="44" width="88" height="10" rx="5" fill="#c4622a"/>
    <path d="M44 44 V36 a6 6 0 0 1 6 -6 H70 a6 6 0 0 1 6 6 V44" fill="none" stroke="#7d4520" stroke-width="5"/>
    <rect x="52" y="60" width="16" height="9" rx="2" fill="#ffd9b8"/>
    <path d="M86 14 l8 8 -26 26 -9 1 1 -9 z" fill="#5b6b7d"/><path d="M86 14 l8 8 4 -4 -8 -8 z" fill="#f5b82e"/>
  </svg>`,
  ok: `<svg viewBox="0 0 96 96" aria-hidden="true">
    <circle cx="48" cy="48" r="40" fill="#2fbf71"/>
    <path d="M30 49 l12 12 24 -26" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  alarm: `<svg viewBox="0 0 96 96" aria-hidden="true">
    <circle cx="48" cy="52" r="32" fill="#e5483d"/>
    <circle cx="48" cy="52" r="24" fill="#fff"/>
    <path d="M48 36 V53 L58 60" fill="none" stroke="#e5483d" stroke-width="6" stroke-linecap="round"/>
    <path d="M18 22 l12 -8 M78 22 l-12 -8" stroke="#e5483d" stroke-width="7" stroke-linecap="round"/>
  </svg>`,
  soon: `<svg viewBox="0 0 96 96" aria-hidden="true">
    <rect x="14" y="20" width="68" height="62" rx="10" fill="#f0a12e"/>
    <rect x="14" y="20" width="68" height="16" rx="8" fill="#c97c0c"/>
    <rect x="28" y="12" width="7" height="16" rx="3.5" fill="#7a4b06"/><rect x="61" y="12" width="7" height="16" rx="3.5" fill="#7a4b06"/>
    <rect x="26" y="46" width="12" height="10" rx="2" fill="#fff"/><rect x="42" y="46" width="12" height="10" rx="2" fill="#fff"/><rect x="58" y="46" width="12" height="10" rx="2" fill="#fff8"/>
    <rect x="26" y="62" width="12" height="10" rx="2" fill="#fff8"/><rect x="42" y="62" width="12" height="10" rx="2" fill="#fff8"/>
  </svg>`,
  logo: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <rect width="120" height="120" rx="28" fill="#2a6fdb"/>
    <path d="M24 58 L60 28 L96 58" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M34 54 V92 H86 V54" fill="#fff"/>
    <circle cx="60" cy="72" r="14" fill="#f5b82e"/>
    <text x="60" y="79" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="19" fill="#2a6fdb">€</text>
  </svg>`
};
