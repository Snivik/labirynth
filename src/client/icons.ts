/**
 * Hand-drawn treasure icons, in the storybook style of the original board:
 * warm flat colours, heavy dark outline, slightly naive shapes.
 *
 * Each entry is the inner markup of a 100x100 viewBox. Original artwork — none
 * of Ravensburger's illustrations are reproduced here.
 */

const OUTLINE = 'stroke="#3b2412" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

const ICONS: Record<string, string> = {
  chest: `
    <path d="M16 48h68v30a5 5 0 0 1-5 5H21a5 5 0 0 1-5-5z" fill="#a4682f"/>
    <path d="M16 48c0-17 15-26 34-26s34 9 34 26z" fill="#c1813d"/>
    <path d="M16 48h68" fill="none"/>
    <rect x="12" y="44" width="76" height="10" rx="3" fill="#e9c25a"/>
    <rect x="43" y="44" width="14" height="26" rx="3" fill="#e9c25a"/>
    <circle cx="50" cy="63" r="4" fill="#6b4420"/>
    <path d="M30 22v26M70 22v26" fill="none" stroke-width="2.4" opacity=".55"/>`,

  crown: `
    <path d="M18 70 12 28l22 15L50 18l16 25 22-15-6 42z" fill="#eec24a"/>
    <rect x="16" y="68" width="68" height="14" rx="5" fill="#d79f31"/>
    <circle cx="50" cy="56" r="5.5" fill="#bf3b2f"/>
    <circle cx="30" cy="59" r="3.5" fill="#2f6f8f"/>
    <circle cx="70" cy="59" r="3.5" fill="#2f6f8f"/>
    <circle cx="12" cy="28" r="4.5" fill="#f4dd8c"/>
    <circle cx="88" cy="28" r="4.5" fill="#f4dd8c"/>
    <circle cx="50" cy="18" r="5" fill="#f4dd8c"/>`,

  ring: `
    <circle cx="50" cy="64" r="21" fill="none" stroke="#3b2412" stroke-width="15"/>
    <circle cx="50" cy="64" r="21" fill="none" stroke="#eec24a" stroke-width="9"/>
    <path d="M50 14 66 30 50 48 34 30z" fill="#bf3b2f"/>
    <path d="M50 14 66 30H34zM34 30l16 18 16-18" fill="none" stroke-width="2" opacity=".5"/>`,

  keys: `
    <g transform="rotate(-18 50 50)">
      <circle cx="34" cy="30" r="13" fill="none" stroke="#3b2412" stroke-width="12"/>
      <circle cx="34" cy="30" r="13" fill="none" stroke="#d9a637" stroke-width="7"/>
      <path d="M34 43v38M34 66h13M34 76h10" stroke="#d9a637" stroke-width="7" fill="none"/>
      <path d="M34 43v38M34 66h13M34 76h10" stroke="#3b2412" stroke-width="2.2" fill="none"/>
    </g>
    <g transform="rotate(20 62 50)">
      <circle cx="66" cy="28" r="11" fill="none" stroke="#3b2412" stroke-width="11"/>
      <circle cx="66" cy="28" r="11" fill="none" stroke="#c8c2b2" stroke-width="6"/>
      <path d="M66 39v36M66 62h11M66 71h9" stroke="#c8c2b2" stroke-width="6" fill="none"/>
      <path d="M66 39v36M66 62h11M66 71h9" stroke="#3b2412" stroke-width="2" fill="none"/>
    </g>`,

  sword: `
    <path d="M50 8 60 26v40H40V26z" fill="#cfd3d6"/>
    <path d="M50 8v58" fill="none" stroke-width="2" opacity=".45"/>
    <rect x="22" y="64" width="56" height="10" rx="4" fill="#d9a637"/>
    <rect x="44" y="72" width="12" height="18" rx="3" fill="#8a5a2a"/>
    <circle cx="50" cy="92" r="6" fill="#d9a637"/>`,

  dagger: `
    <path d="M50 16 58 34v30H42V34z" fill="#e2e5e7"/>
    <path d="M50 16v48" fill="none" stroke-width="2" opacity=".4"/>
    <rect x="30" y="62" width="40" height="9" rx="4" fill="#bf3b2f"/>
    <rect x="45" y="69" width="10" height="16" rx="3" fill="#5c3a1c"/>
    <circle cx="50" cy="88" r="6.5" fill="#2f6f8f"/>`,

  candelabra: `
    <path d="M50 44v34" fill="none" stroke-width="9" stroke="#d9a637"/>
    <path d="M26 46v18M74 46v18" fill="none" stroke-width="8" stroke="#d9a637"/>
    <path d="M26 64q0-20 24-20t24 20" fill="none" stroke-width="8" stroke="#d9a637"/>
    <rect x="34" y="78" width="32" height="8" rx="4" fill="#c08f28"/>
    <g fill="#f2e6c8">
      <rect x="45" y="30" width="10" height="16" rx="3"/>
      <rect x="21" y="32" width="10" height="16" rx="3"/>
      <rect x="69" y="32" width="10" height="16" rx="3"/>
    </g>
    <g fill="#f0a83a" stroke="none">
      <path d="M50 14c5 8 5 12 0 16-5-4-5-8 0-16z"/>
      <path d="M26 18c4 7 4 10 0 14-4-4-4-7 0-14z"/>
      <path d="M74 18c4 7 4 10 0 14-4-4-4-7 0-14z"/>
    </g>`,

  map: `
    <path d="M14 26q18-8 36 0t36 0v50q-18 8-36 0t-36 0z" fill="#e8d9ae"/>
    <path d="M50 26v50" fill="none" stroke-width="2" opacity=".5"/>
    <path d="M26 62q6-16 20-12t12-14" fill="none" stroke="#7a4a1e" stroke-width="2.6" stroke-dasharray="5 4"/>
    <path d="M64 30l10 10M74 30 64 40" stroke="#bf3b2f" stroke-width="4" fill="none"/>
    <circle cx="26" cy="62" r="3" fill="#7a4a1e" stroke="none"/>`,

  purse: `
    <path d="M32 40q-14 12-14 26 0 18 32 18t32-18q0-14-14-26z" fill="#8d5a2b"/>
    <path d="M32 40q8-6 18-6t18 6" fill="#a4682f"/>
    <path d="M28 42q22-10 44 0" fill="none" stroke-width="4" stroke="#5c3a1c"/>
    <path d="M50 20c-6 6-6 12 0 14 6-2 6-8 0-14z" fill="#e9c25a"/>
    <text x="50" y="72" font-size="24" font-family="Georgia,serif" text-anchor="middle" fill="#e9c25a" stroke="none">$</text>`,

  emerald: `
    <path d="M30 24h40l16 22-36 34-36-34z" fill="#2f8f5b"/>
    <path d="M30 24 22 46h56l-8-22M22 46l28 34 28-34" fill="none" stroke-width="2.4" opacity=".55"/>
    <path d="M40 30h20l6 12H34z" fill="#5cbd86" stroke="none" opacity=".7"/>`,

  grimoire: `
    <path d="M22 18h50a8 8 0 0 1 8 8v56a8 8 0 0 1-8 8H22z" fill="#7d3a2e"/>
    <path d="M22 18v72" fill="none" stroke-width="5"/>
    <rect x="30" y="26" width="34" height="12" rx="3" fill="#e9c25a"/>
    <path d="M47 48l4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1z" fill="#e9c25a"/>
    <path d="M80 44h8v14h-8" fill="#c08f28"/>`,

  helmet: `
    <path d="M28 56q0-28 22-28t22 28v10H28z" fill="#b9bec2"/>
    <path d="M28 66h44v8a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill="#8f979c"/>
    <path d="M50 30v36" fill="none" stroke-width="3"/>
    <path d="M28 46q-16-6-22 4 10 8 22 4z" fill="#e9c25a"/>
    <path d="M72 46q16-6 22 4-10 8-22 4z" fill="#e9c25a"/>
    <path d="M42 70h4v10h-4zM54 70h4v10h-4" fill="#5f676b" stroke="none"/>`,

  skull: `
    <path d="M22 46q0-26 28-26t28 26q0 14-8 20v10a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V66q-8-6-8-20z" fill="#efe7d4"/>
    <ellipse cx="38" cy="48" rx="8" ry="9" fill="#3b2412" stroke="none"/>
    <ellipse cx="62" cy="48" rx="8" ry="9" fill="#3b2412" stroke="none"/>
    <path d="M50 58l-5 9h10z" fill="#3b2412" stroke="none"/>
    <path d="M40 76v10M50 76v10M60 76v10" fill="none" stroke-width="2.6"/>`,

  ghost: `
    <path d="M24 84V48q0-26 26-26t26 26v36l-9-8-8 8-9-8-9 8-8-8z" fill="#e6eef4"/>
    <ellipse cx="40" cy="46" rx="6" ry="8" fill="#3b2412" stroke="none"/>
    <ellipse cx="62" cy="46" rx="6" ry="8" fill="#3b2412" stroke="none"/>
    <path d="M44 64q6 6 14 0" fill="none" stroke-width="2.8"/>`,

  bat: `
    <ellipse cx="50" cy="56" rx="11" ry="15" fill="#4b3357"/>
    <path d="M39 48Q22 30 8 36q6 6 4 14 10-2 14 8 6-4 13-2z" fill="#5d3f6b"/>
    <path d="M61 48Q78 30 92 36q-6 6-4 14-10-2-14 8-6-4-13-2z" fill="#5d3f6b"/>
    <path d="M42 42 38 26l10 8 2-10 2 10 10-8-4 16z" fill="#4b3357"/>
    <circle cx="45" cy="52" r="2.6" fill="#f0d35a" stroke="none"/>
    <circle cx="55" cy="52" r="2.6" fill="#f0d35a" stroke="none"/>`,

  spider: `
    <path d="M28 34 12 24M28 48H8M30 60 14 72M72 34 88 24M72 48h20M70 60l16 12" fill="none" stroke-width="4"/>
    <ellipse cx="50" cy="58" rx="20" ry="22" fill="#3d2b3f"/>
    <circle cx="50" cy="34" r="12" fill="#4d3750"/>
    <circle cx="45" cy="32" r="3" fill="#e8d05a" stroke="none"/>
    <circle cx="55" cy="32" r="3" fill="#e8d05a" stroke="none"/>
    <path d="M42 52q8 6 16 0" fill="none" stroke-width="2.4" opacity=".6"/>`,

  moth: `
    <path d="M46 46Q22 26 12 40t16 32q10 4 18-6z" fill="#c9a05e"/>
    <path d="M54 46Q78 26 88 40t-16 32q-10 4-18-6z" fill="#c9a05e"/>
    <ellipse cx="50" cy="56" rx="7" ry="22" fill="#7a4f24"/>
    <circle cx="50" cy="32" r="7" fill="#7a4f24"/>
    <path d="M46 26 38 14M54 26 62 14" fill="none" stroke-width="3"/>
    <circle cx="30" cy="50" r="6" fill="#6b3f2a" stroke="none" opacity=".8"/>
    <circle cx="70" cy="50" r="6" fill="#6b3f2a" stroke="none" opacity=".8"/>`,

  rat: `
    <path d="M16 68q-12 2-10 16" fill="none" stroke-width="4.5"/>
    <ellipse cx="40" cy="60" rx="26" ry="17" fill="#8d8b86"/>
    <circle cx="28" cy="41" r="11" fill="#c4a0a0"/>
    <circle cx="28" cy="41" r="5" fill="#a87f7f" stroke="none"/>
    <path d="M60 46q16-4 22 6 3 5-2 8l-14 6q-10-4-10-12z" fill="#9d9b95"/>
    <path d="M80 52 96 58 80 64" fill="#b7b5af"/>
    <circle cx="70" cy="52" r="2.8" fill="#3b2412" stroke="none"/>
    <circle cx="94" cy="58" r="2.4" fill="#c98a8a" stroke="none"/>
    <path d="M32 76v8M50 77v7" fill="none" stroke-width="3.5"/>`,

  owl: `
    <ellipse cx="50" cy="58" rx="26" ry="28" fill="#a9762f"/>
    <path d="M28 40 22 20l16 10zM72 40l6-20-16 10z" fill="#8d5f24"/>
    <circle cx="39" cy="48" r="11" fill="#f2e6c8"/>
    <circle cx="61" cy="48" r="11" fill="#f2e6c8"/>
    <circle cx="39" cy="48" r="5" fill="#3b2412" stroke="none"/>
    <circle cx="61" cy="48" r="5" fill="#3b2412" stroke="none"/>
    <path d="M50 56 44 64h12z" fill="#e0a02f"/>
    <path d="M34 72q16 10 32 0" fill="none" stroke-width="2.4" opacity=".6"/>`,

  dragon: `
    <path d="M30 62q-14-6-16-22 14 4 22 12z" fill="#2d7a4f"/>
    <path d="M34 74q-4-30 18-34 22-4 30 12 6 10-4 16-8 4-18 2-6 8-14 6z" fill="#3d9a63"/>
    <path d="M62 46q10-14 22-6" fill="none" stroke-width="3"/>
    <circle cx="70" cy="54" r="3" fill="#3b2412" stroke="none"/>
    <path d="M82 62q8 2 10 8-8 2-12-2z" fill="#e0a02f"/>
    <path d="M46 40l6-10 6 10" fill="#256b45"/>`,

  genie: `
    <path d="M28 66q-6-14 8-18h30q10 4 8 14-2 10-14 12H40q-9-2-12-8z" fill="#c08f28"/>
    <path d="M66 52q14-4 20 6-8 2-14-2" fill="#c08f28"/>
    <path d="M40 48q4-8 12-8" fill="none" stroke-width="4"/>
    <ellipse cx="46" cy="76" rx="20" ry="6" fill="#a3761f"/>
    <path d="M52 40q10-10 4-20 12 4 8 16" fill="#9fd3e6" stroke="#5a8fa3" opacity=".9"/>
    <circle cx="66" cy="14" r="5" fill="#9fd3e6" stroke="#5a8fa3"/>`,

  beetle: `
    <ellipse cx="50" cy="56" rx="22" ry="26" fill="#2f7d7a"/>
    <path d="M50 30v52" fill="none" stroke-width="3"/>
    <circle cx="50" cy="26" r="10" fill="#26635f"/>
    <path d="M28 40 12 30M28 56H10M30 70 14 82M72 40l16-10M72 56h18M70 70l16 12" fill="none" stroke-width="3.5"/>
    <path d="M44 20 38 8M56 20 62 8" fill="none" stroke-width="3"/>
    <ellipse cx="50" cy="48" rx="8" ry="10" fill="#4aa39c" stroke="none" opacity=".8"/>`,

  salamander: `
    <path d="M18 70q-6-14 10-16 12-2 16-10 6-12 22-10 16 2 16 14 0 10-12 12-10 2-12 8-4 10-20 8-14-2-20-6z" fill="#c9702f"/>
    <circle cx="76" cy="46" r="3" fill="#3b2412" stroke="none"/>
    <path d="M18 70q-10 4-8 14" fill="none" stroke-width="4"/>
    <path d="M30 62l-4 12M46 56l-2 14M62 50l2 12" fill="none" stroke-width="3"/>
    <circle cx="40" cy="48" r="4" fill="#e8a24a" stroke="none"/>
    <circle cx="58" cy="40" r="4" fill="#e8a24a" stroke="none"/>`,

  bones: `
    <g transform="rotate(-42 50 50)">
      <path d="M22 38q-11 0-11 10 0 8 9 8h-2q-8 1-8 9t11 8q7 0 9-7h40q2 7 9 7t11-8-8-9h-2q9 0 9-8 0-10-11-10t-8 9H30q-1-9-8-9z" fill="#e3d9c0"/>
    </g>
    <g transform="rotate(40 50 50)">
      <path d="M22 38q-11 0-11 10 0 8 9 8h-2q-8 1-8 9t11 8q7 0 9-7h40q2 7 9 7t11-8-8-9h-2q9 0 9-8 0-10-11-10t-8 9H30q-1-9-8-9z" fill="#f3ebd8"/>
    </g>`,
};

/** Inner markup for a treasure icon, wrapped in the shared outline style. */
export function iconBody(key: string): string {
  const body = ICONS[key] ?? ICONS.chest!;
  return `<g ${OUTLINE} fill="none">${body}</g>`;
}

/** Standalone SVG for a treasure, sized by CSS. */
export function iconSVG(key: string, className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">${iconBody(key)}</svg>`;
}

export function hasIcon(key: string): boolean {
  return key in ICONS;
}
