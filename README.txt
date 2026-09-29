Last Train: Station Zero — static web game (no build step).
Deploy: any static host. Vercel:  cd this-folder && npx vercel --prod   (or import the folder as a project, Framework Preset "Other", no build command, output directory ".").
Needs HTTPS (pointer lock + Web Audio + AudioWorklet); Vercel provides it.
Audio credits are in assets/audio/CREDITS.md and shown on the in-game Credits screen. three.js is MIT (vendor/three/LICENSE).
URL flags: ?arsenal=all  ?q=ultra|high|med|low  ?dpr=1  ?bloom=0  ?samples=0  ?oldsamples=0  ?saw=synth|mixed|samples
In game: F3 = diagnostics overlay (fps, GPU, buffers, quality), Shift+F3 = next quality level, F4 = cycle isolation modes (no bloom / no post / hide weapon / hide vfx / hide HUD ...), F6 = copy diagnostics JSON. RMB = aim, V = aim hold/toggle, C = crouch.
Bisect flags for rendering bugs: ?bloom=0 ?nosan=1&noclamp=1 ?nopatch=1 ?maxpx=1 ?hud=0 ?hud=lite ?noguard=1 (see perf/BLACKBOX.md in the source repo).
