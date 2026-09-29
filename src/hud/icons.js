// Inline SVG glyphs for the HUD (all drawn with currentColor so CSS can tint/glow them).
const svg = (vb, body) => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const W = (body) => svg('0 0 64 24', body); // weapon silhouettes share one 64x24 box
const CUT = 'stroke="#000" stroke-opacity=".55" stroke-width="1.3" fill="none"';

export const WEAPON_ICONS = {
  fist: W(`<path d="M5 10h9v10H5z" opacity=".55"/><path d="M14 8.5c0-2.6 2-4.5 4.6-4.5h19c2.6 0 4.2 1 5.4 2.6l3.4.6c2.5.4 4.2 2.2 4.2 4.8v4c0 3.4-2.6 6-6 6H21c-4 0-7-3.2-7-7z"/><path d="M24 4.5v7M31 4.5v7M38 5.5v6" ${CUT}/>`),
  chainsaw: W(`<path d="M5 8.5c0-1.4 1-2.5 2.5-2.5H24c1.4 0 2.5 1.1 2.5 2.5V19c0 1.4-1.1 2.5-2.5 2.5H7.5C6 21.5 5 20.4 5 19z"/><path d="M8 6V3.5h13V6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M26 9.5h31a3.6 3.6 0 0 1 0 7.2H26z"/><path d="M27 13h30" stroke="#000" stroke-opacity=".6" stroke-width="1.8" stroke-dasharray="1.5 1.5"/><circle cx="15" cy="14" r="3" fill="#000" fill-opacity=".45"/>`),
  pistol: W(`<path d="M13 6.5h35v7H13z"/><path d="M48 8h5v4h-5z" opacity=".7"/><path d="M15 13.5h14l-3.4 9.5h-9z"/><path d="M31 13.5v4.2h-5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M20 6.5v7" ${CUT}/>`),
  shotgun: W(`<path d="M9 8h52v3H9z"/><path d="M14 11.6h36v2.6H14z" opacity=".75"/><path d="M12 8h22v8.5H12z"/><path d="M33 12.6h12v4.6H33z"/><path d="M1.5 9.5l10-1.5v10L4 21.5z"/><path d="M38 12.6v4.6" ${CUT}/>`),
  ssg: W(`<path d="M12 5.5h50v3.6H12z"/><path d="M12 10h50v3.6H12z"/><path d="M8 4.5h15v13H8z"/><path d="M30 8.5h16v7.5H30z" opacity=".8"/><path d="M1.5 8l7-1v11l-6 3.5z"/><path d="M38 9v7" ${CUT}/>`),
  chaingun: W(`<path d="M28 4.5h35v2.8H28z"/><path d="M28 9h35v2.8H28z"/><path d="M28 13.5h35v2.8H28z"/><path d="M6 3h23v16H6z"/><path d="M10 19h9v4.2h-9z"/><path d="M34 3.5v13M46 3.5v13M57 3.5v13" ${CUT}/><circle cx="17" cy="11" r="4" fill="#000" fill-opacity=".4"/>`),
  rocket: W(`<path d="M5 6h43a6 6 0 0 1 0 12H5z"/><path d="M48 4.5l13 7.5-13 7.5z" opacity=".85"/><path d="M17 17h7l-1.2 6H16z"/><path d="M12 3.5h12v2.5H12z"/><path d="M13 6v12M36 6v12" ${CUT}/>`),
  plasma: W(`<path d="M5 8h32v9H5z"/><path d="M37 10.4h24v4.6H37z"/><g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="43" cy="12.7" r="4.6"/><circle cx="51" cy="12.7" r="4.6"/><circle cx="59" cy="12.7" r="3.4"/></g><path d="M9 3.5h9V8H9z"/><path d="M12 17h7l-1.6 6h-6z"/>`),
  bfg: W(`<path d="M3 5.5h33l9-3.5h16v20H45l-9-3.5H3z"/><circle cx="55" cy="12" r="5.5" fill="#000" fill-opacity=".5"/><circle cx="55" cy="12" r="2.4"/><path d="M14 5.5v13M26 5.5v13" ${CUT}/><path d="M8 18.5h12v4H8z"/>`),
};

export const ICON_CROSS = svg('0 0 24 24', '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>');
export const ICON_SHIELD = svg('0 0 24 24', '<path d="M12 2l8.5 3.2v6.1c0 5.2-3.6 9.3-8.5 11.2-4.9-1.9-8.5-6-8.5-11.2V5.2z"/><path d="M12 5.5v13c3.1-1.4 5.4-4.2 5.4-7.4V7.4z" fill="#000" fill-opacity=".28"/>');
export const ICON_TRAIN = svg('0 0 24 24', '<path d="M7 2.5h10a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5V5A2.5 2.5 0 0 1 7 2.5z"/><rect x="7" y="5.5" width="10" height="5.5" rx="1" fill="#000" fill-opacity=".55"/><circle cx="8.3" cy="14.6" r="1.3" fill="#000" fill-opacity=".55"/><circle cx="15.7" cy="14.6" r="1.3" fill="#000" fill-opacity=".55"/><path d="M7.5 18.5L5.5 22M16.5 18.5l2 3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>');
export const ICON_SKULL = svg('0 0 24 24', '<path d="M12 2.5c-4.6 0-8 3.2-8 7.4 0 2.6 1.2 4.4 3 5.6V19h3v-2h4v2h3v-3.5c1.8-1.2 3-3 3-5.6 0-4.2-3.4-7.4-8-7.4z"/><circle cx="8.6" cy="10.2" r="2" fill="#000" fill-opacity=".75"/><circle cx="15.4" cy="10.2" r="2" fill="#000" fill-opacity=".75"/><path d="M12 12.5l-1.2 2.4h2.4z" fill="#000" fill-opacity=".75"/>');
