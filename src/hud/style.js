// HUD stylesheet (injected once by hud.js). Everything is sized in em off a vmin-based root so it stays readable at any resolution.
// No external fonts: system DIN-ish sans stack with tabular numerals.
export const CSS = `
#hud{font-size:clamp(10px,2.05vmin,40px);font-family:"Bahnschrift","DIN Alternate","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#eef1ea;user-select:none;-webkit-user-select:none}
#hud .hx-root,#hud .hx-root *{box-sizing:border-box}
.hx-root{position:absolute;inset:0;overflow:hidden;--fg:#eef1ea;--amber:#ffb020;--amber-g:rgba(255,176,32,.5);--red:#ff3d2e;--red-g:rgba(255,61,46,.55);--green:#62e39a;--green-g:rgba(98,227,154,.4);--blue:#5cb6ff;--blue-g:rgba(92,182,255,.45);--plate:rgba(6,9,12,.66);--line:rgba(255,255,255,.14)}
.hx-root.hidden{display:none}
.hx-root.paused *{animation-play-state:paused!important}
.hx-lab{font-size:.6em;letter-spacing:.32em;text-transform:uppercase;opacity:.62;font-weight:600;white-space:nowrap}
.hx-txt-shadow{text-shadow:0 .06em 0 rgba(0,0,0,.85),0 0 .5em rgba(0,0,0,.6)}

/* ---------- full-screen layers ---------- */
.hx-vig,.hx-hb,.hx-flash{position:absolute;inset:0;opacity:0;pointer-events:none;will-change:opacity}
.hx-vig{background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 40%,rgba(160,8,0,.5) 76%,rgba(96,0,0,.92) 100%)}
.hx-hb{background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 52%,rgba(70,0,0,.55) 82%,rgba(20,0,0,.95) 100%)}
.hx-flash{background:#fff}
.hx-dmg{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;display:none}
.hx-dmg::before{content:"";position:absolute;width:46vmin;height:46vmin;left:-23vmin;top:-23vmin;border-radius:50%;
  background:conic-gradient(from -22deg,rgba(255,50,30,0) 0deg,rgba(255,50,30,.95) 22deg,rgba(255,50,30,0) 44deg,rgba(255,50,30,0) 360deg);
  -webkit-mask:radial-gradient(circle,transparent 62%,#000 64%,#000 72%,transparent 74%);mask:radial-gradient(circle,transparent 62%,#000 64%,#000 72%,transparent 74%);filter:drop-shadow(0 0 .5em rgba(255,40,20,.8))}

/* ---------- crosshair ---------- */
.hx-xh{position:absolute;left:50%;top:50%;width:0;height:0;--g:5;transition:opacity .3s}
.hx-xh i{position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.65),0 0 .5em rgba(255,255,255,.35);border-radius:1px;opacity:.92}
.hx-xh .t,.hx-xh .b{width:2px;height:.72em;left:-1px}
.hx-xh .l,.hx-xh .r{height:2px;width:.72em;top:-1px}
.hx-xh .t{top:calc(-1 * (var(--g) * .0667em + .72em))}
.hx-xh .b{top:calc(var(--g) * .0667em)}
.hx-xh .l{left:calc(-1 * (var(--g) * .0667em + .72em))}
.hx-xh .r{left:calc(var(--g) * .0667em)}
.hx-xh .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
.hx-hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;color:#fff}
.hx-hm i{position:absolute;width:2.5px;height:.62em;left:-1.25px;top:-1.6em;background:currentColor;transform-origin:50% 1.6em;box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 .5em currentColor;border-radius:1px}
.hx-hm i:nth-child(1){transform:rotate(45deg)}.hx-hm i:nth-child(2){transform:rotate(135deg)}.hx-hm i:nth-child(3){transform:rotate(225deg)}.hx-hm i:nth-child(4){transform:rotate(315deg)}
.hx-hm.head{color:#ffd54a}.hx-hm.kill{color:#ff3a2a}

/* ---------- top centre: wave + enemies + train ---------- */
.hx-top{position:absolute;top:1.1em;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.5em}
.hx-plate{position:relative;display:flex;align-items:stretch;background:linear-gradient(180deg,rgba(9,12,16,.82),rgba(5,7,10,.66));border-top:.2em solid var(--amber);clip-path:polygon(1em 0,calc(100% - 1em) 0,100% 100%,0 100%);padding:.35em 2.2em .55em 2em;gap:1.4em}
.hx-plate .cell{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.hx-plate .sep{width:1px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.3),transparent);margin:.1em 0}
.hx-plate .val{font-weight:800;font-size:2.5em;letter-spacing:.02em;font-variant-numeric:tabular-nums;margin-top:.06em;text-shadow:0 .05em 0 rgba(0,0,0,.8)}
.hx-plate .wave .val{color:var(--amber);text-shadow:0 0 .5em var(--amber-g),0 .05em 0 rgba(0,0,0,.8)}
.hx-plate .left{min-width:6.5em}
.hx-plate .left .val.clear{color:var(--green);font-size:1.9em;margin-top:.24em;text-shadow:0 0 .5em var(--green-g)}
.hx-plate .left .val.pulse{animation:hxpop .3s ease-out}
.hx-prog{position:absolute;left:1.2em;right:1.2em;bottom:.22em;height:.2em;background:rgba(255,255,255,.1);overflow:hidden}
.hx-prog i{position:absolute;inset:0;background:linear-gradient(90deg,#ff7a2a,var(--red));transform-origin:0 50%;transition:transform .25s ease-out}
.hx-train{display:flex;align-items:center;gap:.6em;font-size:.78em;letter-spacing:.26em;font-weight:700;text-transform:uppercase;padding:.34em 1.1em .34em .8em;background:rgba(6,9,12,.62);border:1px solid var(--line);border-left:.22em solid var(--tc,var(--amber));color:var(--tc,var(--amber));opacity:0;transform:translateY(-.4em);transition:opacity .35s,transform .35s}
.hx-train.on{opacity:1;transform:none}
.hx-train svg{width:1.5em;height:1.5em;fill:currentColor;filter:drop-shadow(0 0 .35em currentColor);flex:none}
.hx-train.warn{--tc:var(--amber);animation:hxblink 1s steps(2,jump-none) infinite}
.hx-train.danger{--tc:var(--red)}
.hx-train.dim{--tc:rgba(238,241,234,.7)}
.hx-train.ok{--tc:var(--green)}

.hx-boss{display:none;flex-direction:column;align-items:center;gap:.35em;width:min(30em,70vw);margin-top:.3em}
.hx-boss.on{display:flex}
.hx-boss .bn{font-size:.85em;letter-spacing:.55em;font-weight:800;color:#ff8a7a;text-shadow:0 0 .6em var(--red-g),0 .06em 0 #000;text-transform:uppercase;padding-left:.55em}
.hx-boss .bb{position:relative;width:100%;height:.8em;background:rgba(0,0,0,.65);border:1px solid rgba(255,90,70,.55);overflow:hidden;box-shadow:0 0 1em rgba(255,60,40,.3)}
.hx-boss .bb i{position:absolute;inset:0;transform-origin:0 50%}
.hx-boss .g{background:rgba(255,255,255,.7)}
.hx-boss .f{background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 55%),linear-gradient(90deg,#b81410,#ff4a34)}
.hx-boss .bb::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(5% - 2px),rgba(0,0,0,.85) calc(5% - 2px),rgba(0,0,0,.85) 5%)}

/* ---------- vitals (bottom-left) ---------- */
.hx-vitals{position:absolute;left:2em;bottom:1.8em;width:20em;display:flex;flex-direction:column;gap:.5em;transition:opacity .5s}
.hx-stat{--c:var(--green);--cg:var(--green-g);position:relative;padding:.5em 1.8em .62em .9em;background:linear-gradient(90deg,rgba(5,8,11,.86),rgba(5,8,11,.56) 78%,rgba(5,8,11,0));border-left:.26em solid var(--c);clip-path:polygon(0 0,100% 0,calc(100% - 1.4em) 100%,0 100%)}
.hx-stat.warn{--c:var(--amber);--cg:var(--amber-g)}
.hx-stat.crit{--c:var(--red);--cg:var(--red-g)}
.hx-stat.armor{--c:var(--blue);--cg:var(--blue-g)}
.hx-stat.armor.none{opacity:.5}
.hx-stat .row{display:flex;align-items:center;gap:.7em}
.hx-ico{width:2.3em;height:2.3em;color:var(--c);filter:drop-shadow(0 0 .4em var(--cg));flex:none}
.hx-ico svg{width:100%;height:100%;display:block;fill:currentColor}
.hx-stat .txt{display:flex;flex-direction:column;line-height:1;gap:.2em}
.hx-num{display:block;font-weight:800;font-size:3.5em;line-height:.86;letter-spacing:-.01em;font-variant-numeric:tabular-nums;transform-origin:0 60%;text-shadow:0 0 .4em var(--cg),0 .05em 0 rgba(0,0,0,.85)}
.hx-stat.crit .hx-num{color:#ff8a7a}
.hx-stat.sm{padding:.34em 1.8em .48em .9em}
.hx-stat.sm .hx-num{font-size:1.9em}
.hx-stat.sm .hx-ico{width:1.55em;height:1.55em}
.hx-bar{position:relative;height:.5em;margin-top:.5em;background:rgba(255,255,255,.1);overflow:hidden}
.hx-stat.sm .hx-bar{height:.34em;margin-top:.36em}
.hx-bar i{position:absolute;inset:0;transform-origin:0 50%}
.hx-bar .g{background:rgba(255,255,255,.75)}
.hx-bar .f{background:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0) 60%),var(--c)}
.hx-bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 2px),rgba(4,6,8,.9) calc(10% - 2px),rgba(4,6,8,.9) 10%)}
.hx-stat.hit{animation:hxshake .34s}
.hx-stat.crit .hx-ico{animation:hxblink .9s steps(2,jump-none) infinite}

/* ---------- weapons (bottom-right) ---------- */
.hx-arms{position:absolute;right:2em;bottom:1.8em;width:24.5em;display:flex;flex-direction:column;align-items:flex-end;gap:.45em;transition:opacity .5s}
.hx-wname{font-weight:800;font-size:1em;letter-spacing:.34em;text-transform:uppercase;color:var(--amber);text-shadow:0 0 .7em var(--amber-g),0 .06em 0 rgba(0,0,0,.85);padding-right:.1em}
.hx-wname.sw{animation:hxsw .32s ease-out}
.hx-ammo{display:flex;align-items:center;gap:.8em;justify-content:flex-end;padding:.3em 1.1em .38em 2.2em;background:linear-gradient(270deg,rgba(5,8,11,.86),rgba(5,8,11,.56) 78%,rgba(5,8,11,0));border-right:.26em solid var(--amber);clip-path:polygon(1.4em 0,100% 0,100% 100%,0 100%)}
.hx-atype{display:flex;flex-direction:column;align-items:flex-end;gap:.3em;line-height:1}
.hx-atype .a{font-size:.72em;letter-spacing:.3em;font-weight:700;color:var(--amber);white-space:nowrap;text-transform:uppercase}
.hx-atype .s{font-size:.6em;letter-spacing:.24em;opacity:.7;font-weight:600;white-space:nowrap;text-transform:uppercase}
.hx-anum{font-weight:800;font-size:3.5em;line-height:.86;letter-spacing:-.01em;font-variant-numeric:tabular-nums;text-shadow:0 0 .4em var(--amber-g),0 .05em 0 rgba(0,0,0,.85);min-width:1.4ch;text-align:right}
.hx-anum.inf{font-size:3em;opacity:.85}
.hx-ammo.low .hx-anum{color:var(--amber)}
.hx-ammo.empty .hx-anum{color:var(--red);animation:hxblink .5s steps(2,jump-none) infinite;text-shadow:0 0 .5em var(--red-g)}
.hx-ammo.pop .hx-anum{animation:hxpop .14s ease-out}
.hx-slots{position:absolute;right:2em;bottom:11.6em;display:flex;flex-direction:column;align-items:flex-end;gap:.28em;transition:opacity .5s}
.hx-slot{position:relative;width:7.4em;height:2.05em;background:linear-gradient(270deg,rgba(6,9,12,.8),rgba(6,9,12,.45));border-right:.22em solid rgba(255,255,255,.14);opacity:.3;color:#cfd6cc;transition:opacity .2s,transform .2s,background .2s,border-color .2s,box-shadow .2s;clip-path:polygon(.8em 0,100% 0,100% 100%,0 100%)}
.hx-slot.own{opacity:.85}
.hx-slot.cur{opacity:1;color:#fff;transform:translateX(-.7em);background:linear-gradient(270deg,rgba(255,176,32,.34),rgba(255,176,32,.08));border-right-color:var(--amber)}
.hx-slot .k{position:absolute;left:1.05em;top:50%;transform:translateY(-50%);font-size:.66em;font-weight:800;opacity:.7;letter-spacing:.05em}
.hx-slot.cur .k{color:var(--amber);opacity:1}
.hx-slot .ic{position:absolute;left:2.2em;width:3.3em;top:.3em;bottom:.3em}
.hx-slot .ic svg{width:100%;height:100%;display:block;fill:currentColor;overflow:visible}
.hx-slot .n{position:absolute;right:.55em;top:50%;transform:translateY(-50%);font-size:.7em;font-weight:800;font-variant-numeric:tabular-nums;opacity:.95;letter-spacing:.03em;text-align:right}
.hx-slot.lowa .n{color:var(--red)}
.hx-slot .mb{position:absolute;left:.8em;right:0;bottom:0;height:.16em;background:rgba(255,255,255,.08)}
.hx-slot .mb b{position:absolute;inset:0;background:var(--amber);transform-origin:0 50%}
.hx-slot.lowa .mb b{background:var(--red)}

/* ---------- right column: score, combo, kill feed ---------- */
.hx-side{position:absolute;right:2em;top:1.2em;width:19em;display:flex;flex-direction:column;align-items:flex-end;gap:.15em;text-align:right}
.hx-score{font-weight:800;font-size:1.9em;letter-spacing:.05em;font-variant-numeric:tabular-nums;line-height:1;text-shadow:0 .05em 0 rgba(0,0,0,.85),0 0 .5em rgba(0,0,0,.5)}
.hx-kills{font-size:.7em;letter-spacing:.3em;opacity:.7;font-weight:600}
.hx-delta{height:1.15em;font-size:1.05em;font-weight:800;color:var(--amber);letter-spacing:.06em;opacity:0;text-shadow:0 0 .6em var(--amber-g),0 .06em 0 #000}
.hx-combo{display:flex;flex-direction:column;align-items:flex-end;gap:.25em;opacity:0;transform:translateX(1em);transition:opacity .25s,transform .25s;min-height:3.6em}
.hx-combo.on{opacity:1;transform:none}
.hx-combo .cx{font-weight:900;font-style:italic;font-size:3em;line-height:.85;letter-spacing:.02em;color:var(--amber);text-shadow:0 0 .5em var(--amber-g),0 .05em 0 #000}
.hx-combo.t2 .cx{color:#ffe08a}.hx-combo.t3 .cx{color:#ff9a3a;text-shadow:0 0 .6em rgba(255,140,40,.6),0 .05em 0 #000}.hx-combo.t4 .cx{color:#ff4a34;text-shadow:0 0 .7em var(--red-g),0 .05em 0 #000}
.hx-combo .cx.bump{animation:hxpop .22s ease-out}
.hx-combo .cb{width:9em;height:.24em;background:rgba(255,255,255,.14);position:relative;overflow:hidden}
.hx-combo .cb i{position:absolute;inset:0;background:currentColor;transform-origin:100% 50%;color:var(--amber)}
.hx-combo .cl{font-size:.55em;letter-spacing:.4em;opacity:.7;font-weight:700}
.hx-feed{display:flex;flex-direction:column;align-items:flex-end;gap:.22em;margin-top:.35em;width:100%}
.hx-kill{display:flex;align-items:center;gap:.55em;font-size:.8em;letter-spacing:.16em;font-weight:700;text-transform:uppercase;padding:.2em .7em .2em 1.6em;background:linear-gradient(270deg,rgba(6,9,12,.72),rgba(6,9,12,0));animation:hxfeed .25s ease-out;transition:opacity .35s,transform .35s;white-space:nowrap}
.hx-kill.out{opacity:0;transform:translateX(1.2em)}
.hx-kill svg{width:1.15em;height:1.15em;fill:currentColor;opacity:.85}
.hx-kill .x{color:var(--amber)}
.hx-kill .tag{font-size:.72em;padding:.12em .5em;background:var(--amber);color:#121212;letter-spacing:.14em;font-weight:900}
.hx-kill .tag.hs{background:#ffd54a}.hx-kill .tag.gib{background:#ff5b3a;color:#fff}.hx-kill .tag.boss{background:#ff3a2a;color:#fff}
.hx-kill.boss{color:#ff8a7a}

/* ---------- banner ---------- */
.hx-banner{position:absolute;left:0;right:0;top:23%;text-align:center;opacity:0;pointer-events:none;--tone:#fff3d6;--glow:rgba(255,176,32,.55)}
.hx-banner[data-tone=clear]{--tone:#d8ffe6;--glow:rgba(98,227,154,.6)}
.hx-banner[data-tone=train]{--tone:#ffe6b0;--glow:rgba(255,176,32,.6)}
.hx-banner[data-tone=danger]{--tone:#ffd9d2;--glow:rgba(255,61,46,.7)}
.hx-banner .bt{display:inline-block;font-weight:900;font-size:min(4.5em,9vw);letter-spacing:.14em;text-transform:uppercase;line-height:1;color:var(--tone);text-shadow:0 0 .35em var(--glow),0 0 1.1em var(--glow),0 .05em 0 rgba(0,0,0,.9);padding-left:.14em}
.hx-banner .bl{height:.42em;width:0;max-width:92vw;margin:.5em auto .55em;background:repeating-linear-gradient(-45deg,var(--amber) 0 .7em,#0d0d0d .7em 1.4em);box-shadow:0 0 1em var(--glow);opacity:.95}
.hx-banner .bs{font-size:min(1.45em,3.4vw);letter-spacing:.42em;text-transform:uppercase;font-weight:700;color:var(--amber);text-shadow:0 .06em 0 rgba(0,0,0,.9),0 0 .7em rgba(0,0,0,.6);padding-left:.42em}
.hx-banner.show{animation:hxbanner var(--dur,2.5s) linear forwards}
.hx-banner.show .bt{animation:hxbt var(--dur,2.5s) cubic-bezier(.2,.8,.2,1) forwards}
.hx-banner.show .bl{animation:hxbl var(--dur,2.5s) cubic-bezier(.2,.8,.2,1) forwards}
.hx-banner.show .bs{animation:hxbs var(--dur,2.5s) linear forwards}

/* ---------- pickup toasts ---------- */
.hx-toasts{position:absolute;left:43%;bottom:5.5em;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.4em}
.hx-toast{--c:var(--amber);display:flex;align-items:baseline;gap:.6em;padding:.3em 1.1em .3em .9em;background:linear-gradient(90deg,rgba(6,9,12,.78),rgba(6,9,12,.5));border-left:.24em solid var(--c);font-size:.95em;letter-spacing:.2em;font-weight:700;text-transform:uppercase;animation:hxtoast .28s ease-out;transition:opacity .3s,transform .3s;white-space:nowrap}
.hx-toast b{color:var(--c);font-size:1.15em;font-weight:900;letter-spacing:.06em}
.hx-toast.out{opacity:0;transform:translateY(-.6em)}
.hx-toast.bump{animation:hxpop .2s ease-out}
.hx-toast.big{font-size:1.2em;padding:.4em 1.4em .4em 1.1em}

/* ---------- keyframes ---------- */
@keyframes hxpop{0%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes hxblink{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes hxshake{0%{transform:translateX(0)}18%{transform:translateX(-.55em)}36%{transform:translateX(.4em)}54%{transform:translateX(-.25em)}72%{transform:translateX(.12em)}100%{transform:none}}
@keyframes hxsw{0%{opacity:0;transform:translateX(1.5em)}100%{opacity:1;transform:none}}
@keyframes hxfeed{0%{opacity:0;transform:translateX(1.4em)}100%{opacity:1;transform:none}}
@keyframes hxtoast{0%{opacity:0;transform:translateY(.9em) scale(.92)}100%{opacity:1;transform:none}}
@keyframes hxbanner{0%{opacity:0}6%{opacity:1}84%{opacity:1}100%{opacity:0}}
@keyframes hxbt{0%{transform:scale(1.5);letter-spacing:.5em}9%{transform:scale(1);letter-spacing:.14em}88%{transform:scale(1.03);letter-spacing:.16em}100%{transform:scale(1.08);letter-spacing:.2em}}
@keyframes hxbl{0%{width:0}12%{width:0}26%{width:min(26em,88vw)}88%{width:min(26em,88vw)}100%{width:min(29em,90vw)}}
@keyframes hxbs{0%{opacity:0;transform:translateY(.6em)}16%{opacity:0;transform:translateY(.6em)}30%{opacity:1;transform:none}100%{opacity:1;transform:none}}

/* ---------- dead ---------- */
.hx-root.dead .hx-vitals,.hx-root.dead .hx-arms,.hx-root.dead .hx-side,.hx-root.dead .hx-slots{opacity:.25}
.hx-root.dead .hx-xh,.hx-root.dead .hx-hm{opacity:0!important}

@media (max-aspect-ratio:1/1){.hx-vitals{width:16em}.hx-arms{width:21em;transform:scale(.9);transform-origin:100% 100%}.hx-side{width:14em;top:9.5em}.hx-toasts{left:50%;bottom:9.5em}.hx-slots{bottom:10.5em}}
`;
