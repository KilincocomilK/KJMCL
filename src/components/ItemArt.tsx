import type { ReactNode } from 'react';

// Inventory sprites share a 16-unit grid. Each face has its own light and shadow.
const sprites = {
  block: (
    <>
      <path fill="#33281f" d="M1 3h14v11H1z" />
      <path fill="#9d6640" d="M2 4h12v9H2z" />
      <path fill="#805033" d="M2 10h3v2H2zm5 1h3v2H7zm5-4h2v2h-2z" />
      <path fill="#c78b52" d="M5 8h2v2H5zm6 2h2v1h-2z" />
      <path fill="#579044" d="M2 4h12v2h-2v2h-2V6H7v2H5V7H2z" />
      <path fill="#aad368" d="M2 3h12v2H2z" />
      <path fill="#88b858" d="M3 4h3v1H3zm6-1h3v1H9z" />
    </>
  ),
  versions: (
    <>
      <path fill="#493727" d="M1 3h11v1h2v3h1v3h-2v3H3v-1H1z" />
      <path fill="#d7a15e" d="M2 3h9v1h2v2H3V5H2z" />
      <path fill="#f1cf8c" d="M4 5h8v1H4z" />
      <path fill="#627f77" d="M1 7h11v1h2v2H3V9H1z" />
      <path fill="#a5c1a8" d="M4 8h9v1H4z" />
      <path fill="#b36844" d="M2 10h10v1h1v2H4v-1H2z" />
      <path fill="#f3bd79" d="M5 11h7v1H5z" />
    </>
  ),
  chest: (
    <>
      <path fill="#3e2d24" d="M1 4h14v10H1z" />
      <path fill="#a36637" d="M2 5h12v8H2z" />
      <path fill="#e4aa58" d="M2 4h12v2H2z" />
      <path fill="#c38542" d="M3 9h10v3H3z" />
      <path fill="#493a31" d="M2 7h12v2H2zm1-2h1v2H3zm9 0h1v2h-1z" />
      <path fill="#ffda90" d="M3 4h6v1H3z" />
      <path fill="#776858" d="M7 7h3v4H7z" />
      <path fill="#e6dcc1" d="M7 7h2v3H7z" />
    </>
  ),
  pickaxe: (
    <>
      <path fill="#473429" d="M1 12h2v-2h2V8h2V6h2V4h3v4h-2v2H8v2H6v2H4v1H1z" />
      <path fill="#cc8c51" d="M2 12h2v-2h2V8h2V6h2v2H9v2H7v2H5v2H2z" />
      <path fill="#41686a" d="M3 1h6v1h3v2h2v3h1v5h-2V9h-2V6H8V4H5V3H3z" />
      <path fill="#70c8c0" d="M4 1h5v1h3v2h2v4h-2V6h-2V4H7V3H4z" />
      <path fill="#c2e9cd" d="M4 1h5v1H4zm6 2h2v1h-2z" />
    </>
  ),
  robot: (
    <>
      <path fill="#965b3e" d="M7 1h2v3H7zM1 6h14v6h-2v2H3v-2H1z" />
      <path fill="#e6a66c" d="M3 4h10v8H3z" />
      <path fill="#f5ca8d" d="M3 4h10v2H3z" />
      <path fill="#453b35" d="M4 7h8v4H4z" />
      <path fill="#a7e0ce" d="M5 8h2v2H5zm4 0h2v2H9z" />
      <path fill="#c18052" d="M5 12h6v1H5z" />
      <path fill="#8bbda2" d="M7 1h2v1H7z" />
    </>
  ),
  book: (
    <>
      <path fill="#433124" d="M2 2h11v1h1v10H4v1H2z" />
      <path fill="#9d623f" d="M3 3h10v9H3z" />
      <path fill="#d4a36a" d="M4 3h2v8H4z" />
      <path fill="#77482f" d="M7 4h5v5H7z" />
      <path fill="#edca80" d="M8 5h3v1H8zm-1 5h5v1H7z" />
      <path fill="#f3dfa6" d="M4 12h9v1H4z" />
    </>
  ),
  globe: (
    <>
      <path fill="#476970" d="M5 1h6v1h2v2h2v7h-2v2h-2v2H5v-2H3v-2H1V5h2V3h2z" />
      <path fill="#72b6c2" d="M5 2h6v1h2v2h1v5h-2v2h-2v1H5v-1H3V5h1V3h1z" />
      <path fill="#a6ba71" d="M5 3h4v2H7v2H5v2H3V5h2zm5 4h4v3h-2v2h-2V9H8V7z" />
      <path fill="#cde0af" d="M5 3h3v1H5z" />
    </>
  ),
  dust: (
    <>
      <path fill="#6b3631" d="M1 11h2V9h2V6h2V3h3v3h2v2h2v3h1v3H1z" />
      <path fill="#bd5847" d="M2 11h2V9h2V6h2V4h2v4h2v2h2v2H2z" />
      <path fill="#ee8060" d="M4 10h2V8h2v2H7v1H4zm5-4h1v2H9z" />
      <path fill="#ffbb83" d="M7 6h2v2H7z" />
    </>
  ),
  hopper: (
    <>
      <path fill="#425359" d="M1 7h14v3h-2v2h-2v2H7v-2H5v-2H3V9H1z" />
      <path fill="#94a6a5" d="M1 7h14v2H1z" />
      <path fill="#687e81" d="M4 10h8v1H4zm3 2h3v2H7z" />
      <path fill="#d8ae72" d="M7 1h3v3h2v1h-1v1H9v1H8V6H6V5H5V4h2z" />
      <path fill="#ffe3a0" d="M7 1h2v3H7z" />
    </>
  ),
  gear: (
    <>
      <path
        fill="#899594"
        d="M6 1h4v2h2V2h2v3h-1v1h2v4h-2v1h1v3h-2v-1h-2v2H6v-2H4v1H2v-3h1v-1H1V6h2V5H2V2h2v1h2z"
      />
      <path fill="#c6ccbd" d="M6 1h4v2H6zM2 2h2v3H2zM1 6h2v3H1z" />
      <path fill="#425157" d="M5 6h1V5h4v1h1v4h-1v1H6v-1H5z" />
      <path fill="#262c2a" d="M6 6h4v4H6z" />
    </>
  ),
  face: (
    <>
      <path fill="#593e37" d="M2 2h12v12H2z" />
      <path fill="#d49a71" d="M3 4h10v9H3z" />
      <path fill="#754733" d="M3 3h10v3h-2V5H6v1H4v2H3z" />
      <path fill="#9a623f" d="M4 3h4v1H4z" />
      <path fill="#eee1c5" d="M4 7h3v2H4zm5 0h3v2H9z" />
      <path fill="#546983" d="M6 7h1v2H6zm3 0h1v2H9z" />
      <path fill="#b57d5e" d="M7 9h2v2H7z" />
      <path fill="#865544" d="M6 11h4v1H6z" />
    </>
  ),
  map: (
    <>
      <path fill="#564638" d="M1 3h4V2h2v1h3V2h5v11h-4v1H9v-1H6v1H1z" />
      <path fill="#e4c98e" d="M2 4h3v8H2zm4-1h1v1h3v8H7v-1H6zm5 1h3v8h-3z" />
      <path fill="#96a96e" d="M2 5h3v2H4v2H2zm6 3h2v3H8zm3-3h3v2h-3z" />
      <path fill="#77b0b5" d="M5 6h2v2h2v1h2v2H9v-1H7V9H5z" />
      <path fill="#ca7247" d="M11 7h2v2h-2z" />
    </>
  ),
  brush: (
    <>
      <path fill="#573e32" d="M2 12h2v-2h2V8h2V4h2V2h4v4h-1v2h-2v2H9v1H7v2H5v2H2z" />
      <path fill="#ce975b" d="M3 12h2v-2h2V8h2v2H8v2H6v1H5v1H3z" />
      <path fill="#c6c8af" d="M7 7h2V6h1v2h1v1H9v1H8V9H7z" />
      <path fill="#cf6c55" d="M9 4h2V2h2v4h-1v2h-2V7H9z" />
      <path fill="#ffb588" d="M11 3h1v2h-1z" />
    </>
  ),
  plan: (
    <>
      <path fill="#304753" d="M2 2h12v12H2z" />
      <path fill="#558396" d="M3 3h10v10H3z" />
      <path fill="#7ba7ad" d="M4 3h1v10H4zm6 0h1v10h-1zM3 5h10v1H3zm0 5h10v1H3z" />
      <path fill="#e2e7c2" d="M6 4h4v1h2v5h-2v1H6v-1H4V5h2zm0 2H5v3h2V7H6zm2 1v3h1V9h2V6H9v1z" />
    </>
  ),
  sun: (
    <>
      <path
        fill="#d79a4e"
        d="M7 0h2v2H7zM2 2h2v2H2zm10 0h2v2h-2zM0 7h2v2H0zm14 0h2v2h-2zM2 12h2v2H2zm10 0h2v2h-2zm-5 2h2v2H7z"
      />
      <path fill="#ebad53" d="M5 3h6v2h2v6h-2v2H5v-2H3V5h2z" />
      <path fill="#ffe49b" d="M5 5h6v6H5z" />
    </>
  ),
  reel: (
    <>
      <path fill="#566267" d="M1 3h14v10H1z" />
      <path fill="#a1abaa" d="M2 4h12v8H2z" />
      <path
        fill="#344447"
        d="M3 4h2v1H3zm4 0h2v1H7zm4 0h2v1h-2zm-8 7h2v1H3zm4 0h2v1H7zm4 0h2v1h-2zM3 6h10v4H3z"
      />
      <path fill="#e4b77a" d="M7 6h1v1h2v2H8v1H7z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type ItemName = keyof typeof sprites;

export function ItemArt({ name, size = 24 }: { name: ItemName; size?: number }) {
  return (
    <svg
      className="item-art"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {sprites[name]}
    </svg>
  );
}
