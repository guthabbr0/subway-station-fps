// Module Worker: renders the whole sound bank off the main thread and streams Float32Arrays back.
import { renderSound, variantsOf, SOUNDS } from './render.js';
import { makeImpulse } from './impulse.js';

let jobs = [], running = false;
function next() {
  const j = jobs.shift();
  if (!j) { running = false; postMessage({ done: true }); return; }
  try {
    if (j.ir) { const [l, r] = makeImpulse(); postMessage({ ir: [l, r] }, [l.buffer, r.buffer]); }
    else { const data = renderSound(j.name, j.v); if (data) postMessage({ name: j.name, v: j.v, data }, [data.buffer]); }
  } catch (e) { postMessage({ error: String(e && e.stack || e), name: j.name }); }
  setTimeout(next, 0); // yield so 'prio' messages can be handled between renders
}
onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'render') {
    jobs = [{ ir: true }];
    for (const name of m.names) if (SOUNDS[name]) for (let v = 0; v < variantsOf(name); v++) jobs.push({ name, v });
    if (!running) { running = true; setTimeout(next, 0); }
  } else if (m.cmd === 'prio') {
    const first = jobs.filter((j) => j.name === m.name); jobs = first.concat(jobs.filter((j) => j.name !== m.name));
  }
};
