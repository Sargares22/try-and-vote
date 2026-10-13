// Try-and-vote pages (see ../SKILL.md). Node 18+, no dependencies.
//
//   node demo.mjs init <folder> [--lang ru|en]
//       Starts a page: copies the example product file to <folder>/demo.html. Without --lang the
//       example is in the system's language when that is Russian, otherwise in English.
//   node demo.mjs check <folder>/demo.html [--tab id] [--full] [--shots shots.json]
//       Puts the frame around the product file, checks the rules, takes pictures: one sheet per
//       tab with every state on it (--full: separate full-size pictures; --tab: one tab only). Writes out/page.html (publish this one), out/standalone.html
//       (opens from disk) and out/shots/*.png beside the product file.
//   node demo.mjs mark <folder>/demo.html
//       Run right after publishing: remembers what the owner has been shown, so the next
//       check can demand "updated" marks and a new revision for whatever changed since.
//   node demo.mjs stop [<folder>/demo.html]
//       Ends the servers this skill started (all of them, or the one of that page).
//   node demo.mjs serve <folder>/demo.html [--port 4717] [--lan] [--idle 20] [--stay]
//       Works in any harness. The page on http://127.0.0.1:<port> (--lan: also for a tablet or phone on
//       the same network), answers written to verdicts.json beside it. When the owner presses "done"
//       it prints the answers in piles and exits: start it as a background command and you are woken.
//       It also exits by itself 20 minutes after the page was closed, and never runs twice for one page.
//   node demo.mjs verdicts <verdicts.json | folder of <id>.json | -> [--page demo.html]
//       The answers sorted into piles. "-" reads JSON from standard input. With --page, the spots the
//       owner marked in the mock are also drawn: out/notes/<tab>.png, each spot ringed and numbered.
//   node demo.mjs brief <folder>
//       Handing the build to another agent: first run writes brief.json to fill in, the next prints
//       the text to give the builder.
//   node demo.mjs eval --prepare <dir>   then   node demo.mjs eval <dir>
//       Can a given model build pages by this skill? Lays out ready briefs, then grades the results.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces, release, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skill = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, args = [];
// Flags that take no value, so a path after them stays a path
const SWITCHES = ['prepare', 'full', 'lan', 'stay', 'example', 'no-pictures', 'all'];
for (let i = 0; i < rest.length; i++) rest[i].startsWith('--') ? flags[rest[i].slice(2)] = !SWITCHES.includes(rest[i].slice(2)) && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : '' : args.push(rest[i]);
const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
// A command printed for someone to run next: full path of this script, paths in quotes
const q = p => `"${p}"`, me = () => `node ${q(fileURLToPath(import.meta.url))}`;
function number(name, def, min, max) {
  if (!(name in flags)) return def;
  const n = Number(flags[name]);
  if (!Number.isFinite(n) || n < min || n > max) { console.error(`--${name} must be a number from ${min} to ${max}, got "${flags[name]}"`); process.exit(2); }
  return n;
}
function need(file) {
  if (!file || !existsSync(file) || statSync(file).isDirectory()) { console.error('No such product file: ' + (file || '(not given)')); process.exit(2); }
  return resolve(file);
}

// ---------- the page: frame + product file ----------
// A fragment without doctype or body: that is what Claude's Artifact tool publishes.
function compose(product) {
  const src = readFileSync(product, 'utf8');
  const title = src.match(/<title>([^<]*)<\/title>/i);
  return `<title>${title ? title[1] : 'Feature candidates'}</title>\n<script>window.__demoRev="${sha(src)}"</script>\n`
    + readFileSync(join(skill, 'assets', 'frame.html'), 'utf8').replace('<!--PRODUCT-->', () => src.replace(/<title>[^<]*<\/title>\s*/i, ''));
}
// The same skeleton the Artifact tool puts around a fragment, so a local look matches the published one
const HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>';
const wrap = (product, early = '', late = '') => `${HEAD}${early}</head><body>\n${compose(product)}\n${late}</body></html>`;

// ---------- headless browser ----------
// Every installed candidate. Which one works is found by trying: a browser can be installed and
// still print nothing headless (seen with Edge inside a sandboxed agent session on Windows).
// Inside WSL there is usually no Linux browser, but the Windows one runs through interop. It needs
// Windows paths and a working folder on a Windows drive.
const wsl = process.platform === 'linux' && /microsoft/i.test(release());
const winPath = p => execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim();
function browsers(soft) {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const found = [process.env.DEMO_BROWSER,
    ...pf.map(p => join(p, 'Google/Chrome/Application/chrome.exe')), ...pf.map(p => join(p, 'Microsoft/Edge/Application/msedge.exe')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge',
    ...(wsl ? ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe', '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe'] : [])].filter(p => p && existsSync(p));
  if (!found.length && soft) return found;
  if (!found.length) { console.error('No Chrome, Chromium or Edge found, and check needs one for its rules and pictures.\nInstall one or set DEMO_BROWSER to a browser executable.'); process.exit(2); }
  return found;
}
// `loose`: inside a restricted agent session (seen with Codex on Windows) the browser cannot start its own
// sandbox and dies at once; started without it, it works. That start is tried only after the normal one failed.
let exe = null, browserSaid = '', loose = false;
// Extra browser flags for a machine that needs them, e.g. DEMO_BROWSER_ARGS="--no-sandbox" inside a sandboxed agent
const moreArgs = (process.env.DEMO_BROWSER_ARGS || '').split(' ').filter(Boolean);
const EARLY = '<script>window.__errs=[];addEventListener("error",e=>__errs.push(e.message||String(e)));addEventListener("unhandledrejection",e=>__errs.push(String(e.reason)))</script>'
  + '<style>*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}</style>';
// A headless window is never narrower than about 500 px, so a phone-width page is shown in a
// frame of the asked width inside a wider window: the picture has the page on the left.
function run(work, file, html, size, extra) {
  writeFileSync(file, html);
  const [w, h] = size.split('x').map(Number);
  if (w < 520 && !file.endsWith('sheet.html')) {
    const inner = file;
    file = join(work, 'outer.html');
    size = `520x${h}`;
    writeFileSync(file, `<!doctype html><body style="margin:0;background:#777"><iframe src="${basename(inner)}" style="display:block;border:0;width:${w}px;height:${h}px"></iframe>
      <script>addEventListener("message",e=>{if(typeof e.data!=="string"||e.data.indexOf("__probe:"))return;const p=document.createElement("pre");p.id="__probe";p.textContent=e.data.slice(8);document.body.append(p)})</script>`);
  }
  // A Windows browser started from WSL takes Windows paths
  const win = wsl && exe.endsWith('.exe'), there = p => win ? winPath(p) : p;
  const url = win ? 'file:///' + encodeURI(winPath(file).replace(/\\/g, '/')) : pathToFileURL(file).href;
  const t0 = Date.now(); if (process.env.DEMO_TIMING) process.on("exit", () => 0);
  try { const r = execFileSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', ...moreArgs, ...(loose ? ['--no-sandbox'] : []), `--window-size=${size.replace('x', ',')}`,
    `--user-data-dir=${there(join(work, 'profile'))}`, '--virtual-time-budget=4000', ...extra.map(a => a.startsWith('--screenshot=') ? '--screenshot=' + there(a.slice(13)) : a), url],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000, killSignal: 'SIGKILL' }); if (process.env.DEMO_TIMING) console.error(basename(file), Date.now() - t0, 'ms'); return r; }
  catch (e) { if (process.env.DEMO_TIMING) console.error(basename(file), 'FAILED after', Date.now() - t0, 'ms', e.code || e.signal || ''); browserSaid = `${exe}\n${String(e.stderr || e.message).trim().split('\n').slice(-6).join('\n')}`; throw e; }
}
// One run that walks every tab and reports what a picture cannot: errors, sideways scroll, page height, an empty mock.
// With a second size the page is put twice into one window, side by side, each at its own width: one browser
// start answers for the desktop and for the phone, and the answer is a pair.
function probe(work, product, size, also) {
  const late = `<script>setTimeout(()=>{const out={tabs:[],errs:__errs,width:innerWidth,config:window.demo&&demo.config};try{for(const t of demo.tabs){demo.go(t.id);const d=document.documentElement,s=document.getElementById("fd-stage");
    const b=s.querySelector(".fd-s-body")||s,H=d.scrollHeight,W=d.scrollWidth>innerWidth?d.scrollWidth:0,N=b.childElementCount;
    const look=()=>b.innerHTML+[...b.querySelectorAll("*")].map(e=>e.className+e.getAttribute("style")+e.getAttribute("aria-pressed")+(e.value||"")+(e.checked?"✓":"")).join("|");
    let hh=5381;for(const ch of b.innerHTML)hh=(hh*33^ch.charCodeAt(0))>>>0;
    const SEL="button,[role=button],[data-touch],input[type=checkbox],input[type=radio]",press=[...b.querySelectorAll(SEL)].slice(0,12);let reacts=0;
    // a mock may redraw itself on every press: look the next thing up again each time
    for(let i=0;i<press.length;i++){const p=b.querySelectorAll(SEL)[i];if(!p)break;const was=look();try{p.click()}catch(e){}if(look()!==was)reacts++}
    out.tabs.push({...t,height:H,wide:W,drawn:N,dom:hh,pressable:press.length,reacts,touch:s.querySelectorAll("button,input,select,textarea,canvas,[role=button],[data-touch]").length})}}catch(e){out.errs.push("demo: "+e.message)}
    const p=document.createElement("pre");p.id="__probe";p.textContent=btoa(encodeURIComponent(JSON.stringify(out)));document.body.append(p);
    if(parent!==window)parent.postMessage("__probe:"+p.textContent,"*")},300)</script>`;
  const inner = wrap(product, EARLY, late), dims = [size, also].filter(Boolean).map(s => s.split('x').map(Number));
  const both = also && `<!doctype html><body style="margin:0;display:flex;align-items:flex-start;background:#777">${dims.map(([w, h]) => `<iframe src="probe.html" style="flex:none;border:0;width:${w}px;height:${h}px"></iframe>`).join('')}
    <script>addEventListener("message",e=>{const i=[...document.querySelectorAll("iframe")].findIndex(f=>f.contentWindow===e.source);if(i<0||typeof e.data!=="string"||e.data.indexOf("__probe:")||document.getElementById("__probe"+i))return;
      const p=document.createElement("pre");p.id="__probe"+i;p.textContent=e.data.slice(8);document.body.append(p)})</script>`;
  const read = dom => also ? [0, 1].map(i => dom.match(new RegExp(`<pre id="__probe${i}">([^<]*)</pre>`))) : [dom.match(/<pre id="__probe">([^<]*)<\/pre>/)];
  let m = null, answered = false;
  // On a loaded machine a headless start can stall: each browser gets two tries, then one without its own sandbox
  for (const [b, l] of exe ? [[exe, loose], [exe, loose]] : [...browsers().flatMap(b => [[b, false], [b, false]]), ...browsers().map(b => [b, true])]) {
    if (l && answered) break;   // the browser starts; it is the page that gave no answer
    exe = b; loose = l;
    let dom = '';
    try {
      if (also) writeFileSync(join(work, 'probe.html'), inner);
      dom = also ? run(work, join(work, 'both.html'), both, `${dims[0][0] + dims[1][0]}x${Math.max(dims[0][1], dims[1][1])}`, ['--dump-dom']) : run(work, join(work, 'probe.html'), inner, size, ['--dump-dom']);
    } catch { }
    answered ||= dom.length > 0;
    if ((m = read(dom)).every(Boolean)) break;
    m = null; exe = null;
  }
  if (!m) {
    console.error(answered ? 'The page did not start. Is window.DEMO set in the product file?'
      : `No browser could start headless here, with or without its own sandbox.
In a restricted agent session: run this same command outside the restriction; nothing in the page needs changing.
Otherwise set DEMO_BROWSER to a browser that works here, or DEMO_BROWSER_ARGS to the flags it needs.${browserSaid ? '\nThe last one said:\n' + browserSaid.split('\n').filter((l, n, a) => !n || n >= a.length - 2).join('\n') : ''}`);
    process.exit(1);
  }
  const out = m.map(x => JSON.parse(decodeURIComponent(Buffer.from(x[1], 'base64').toString('latin1'))));
  return also ? out : out[0];
}
function withWork(fn) {
  let base = tmpdir();
  if (wsl) try { base = execFileSync('wslpath', ['-u', execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()], { encoding: 'utf8' }).trim(); } catch { }
  const work = mkdtempSync(join(base, 'demo-shot-'));
  try { return fn(work); } finally { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}

// ---------- the brief ----------
// brief.json beside demo.html: {product, lang, surface, look_at:[paths], candidates:[{id, title, what, press, variants:[..], lvl, who, caveat}]}
const briefOf = product => { const f = join(dirname(product), 'brief.json'); try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch (e) { return { broken: String(e.message) }; } };
function brief() {
  const dir = resolve(args[0] || '.'), file = join(dir, 'brief.json');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ product: 'One or two sentences: what the product is and who uses it.', lang: 'ru', surface: 'phone',
      look_at: ['paths to the real page, stylesheet or screenshots the mock must be drawn from'],
      candidates: [{ id: 'short-latin-id', title: 'The feature through the user\'s eyes', what: 'What it does and why, two sentences.', press: 'What the owner should press to feel it.',
        variants: ['as now', 'new'], lvl: 1, who: 'Who proposed it and the opinions, one line.', caveat: '' }] }, null, 1));
    console.log(`${file}\n\nFill it in: it is all the builder gets, so name real files in look_at and say what to press.\nThen run this command again for the text to hand to the builder.`);
    return;
  }
  const b = briefOf(join(dir, 'demo.html'));
  if (b.broken || !Array.isArray(b.candidates)) { console.error('brief.json is broken: ' + (b.broken || 'no candidates')); process.exit(1); }
  const me = fileURLToPath(import.meta.url);
  console.log(`Build a try-and-vote page. You are the builder; the decisions are already made and are in the brief.

Skill: ${join(skill, 'SKILL.md')} - read it first and follow it.
Brief: ${file} - what to build: the product, the language, the surface, the files to draw the mock from, and ${b.candidates.length} candidate feature(s).
Work in: ${dir} - write demo.html there, beside the brief. Start with: node "${me}" init "${dir}" --lang ${b.lang === 'en' ? 'en' : 'ru'}

Done means: node "${me}" check "${join(dir, 'demo.html')}" prints no PROBLEM lines, and you have opened every picture it wrote.
One tab per candidate, with the candidate's id. Nothing that is not in the brief. Do not run serve, do not publish, do not commit.
Report: the number of check runs, every PROBLEM line you hit, and anything in the brief you had to guess.`);
}

// ---------- the rules a script can check ----------
const state = product => join(dirname(product), '.shown.json');
const tabHash = t => sha(JSON.stringify([t.tab, t.title, t.desc, t.who, t.do, t.lvl, t.caveat, t.reply, t.surface, t.controls, t.code, t.dom]));
function lint(product, seen) {
  const out = [], bad = m => out.push('PROBLEM ' + m), c = seen.config || {}, tabs = seen.tabs;
  for (const e of new Set(seen.errs)) bad(`script error: ${e}`);
  if (!tabs.length) bad('no tabs: window.DEMO.tabs is empty');
  if (!c.key || !/^[\w-]+$/.test(c.key)) bad('DEMO.key is missing: a short latin name, unique to this page');
  const example = dirname(resolve(product)) === resolve(join(skill, 'assets'));
  if (!example && !('example' in flags) && (c.key === 'leika-candidates' || /Монстера|Monstera/.test(readFileSync(product, 'utf8')))) bad('the example product is still in the file (key "leika-candidates" or the plant list): replace all of it');
  const ids = new Set();
  for (const t of tabs) {
    const p = m => bad(`tab "${t.id}": ${m}`);
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(t.id || '')) p('id must be a short latin word');
    if (ids.has(t.id)) p('id is used twice'); ids.add(t.id);
    for (const [k, max] of [['tab', 24], ['title', 70], ['desc', 240], ['do', 170]]) {
      if (!t[k]) p(`"${k}" is empty`); else if (t[k].length > max) p(`"${k}" is ${t[k].length} characters, the limit is ${max}: the owner opens the page to touch, not to read`);
    }
    if (t.surface && !['phone', 'tablet', 'window', 'browser', 'bare', 'fill'].includes(t.surface)) p(`surface "${t.surface}" is unknown: phone, tablet, window, browser, bare or fill`);
    if (!t.hasMount) p('no mount(stage, v) function'); else if (!t.drawn) p('mount() drew nothing into the stage');
    else if (!t.touch) p('nothing in the mock can be pressed (no button, input or canvas; mark other touchable things with data-touch)');
    else if (t.pressable && !t.reacts) p(`${t.pressable} thing(s) in the mock can be pressed and none of them changes anything on screen: the feature has to work, with a visible answer to every press`);
    for (const k of t.controls) if (k.options.length < 2) p(`switch "${k.id}" needs at least two options`);
    if (t.wide) p(`scrolls sideways: ${t.wide}px in a ${seen.width}px window`);
  }
  // What changed since the owner was last shown the page must be findable
  let was = null;
  if (existsSync(state(product))) try { was = JSON.parse(readFileSync(state(product), 'utf8')); if (!was || typeof was.tabs !== 'object') throw new Error('no tabs in it'); }
    catch (e) { was = null; bad(`.shown.json beside the page is broken (${e.message}): delete it and run mark again after showing the page`); }
  if (was) {
    const file = sha(readFileSync(product, 'utf8'));
    if (was.file !== file) {
      const changed = tabs.filter(t => was.tabs[t.id] !== tabHash(t));
      for (const t of changed) if (!t.upd) bad(`tab "${t.id}" is new or changed since it was shown: set upd:true on it`);
      for (const id of Object.keys(was.tabs)) if (!ids.has(id) && was.answered?.includes(id)) bad(`tab "${id}" has the owner's answer and is gone: keep its id`);
    }
  }
  return out;
}

function check() {
  const product = need(args[0]), dir = join(dirname(product), 'out'), shotsDir = join(dir, 'shots');
  const sizes = { desktop: flags.desktop || '1280x860', phone: flags.phone || '400x860' };
  if (!flags.tab && !('no-pictures' in flags)) rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(join(dir, 'page.html'), compose(product));
  writeFileSync(join(dir, 'standalone.html'), wrap(product));
  const problems = withWork(work => {
    const [desktop, phone] = probe(work, product, sizes.desktop, sizes.phone), seen = { desktop, phone };
    const problems = lint(product, seen.desktop);
    // a page can break at phone width only: its errors and missing tabs count too
    for (const e of new Set(seen.phone.errs)) if (!seen.desktop.errs.includes(e)) problems.push(`PROBLEM script error at phone width: ${e}`);
    if (seen.phone.tabs.length < seen.desktop.tabs.length) problems.push('PROBLEM at phone width the page stops before all tabs have opened');
    for (const t of seen.phone.tabs) if (t.hasMount && !t.drawn) problems.push(`PROBLEM tab "${t.id}": draws nothing at phone width`);
    for (const t of seen.phone.tabs) if (t.wide) problems.push(`PROBLEM tab "${t.id}": scrolls sideways at phone width: ${t.wide}px in a ${seen.phone.width}px window`);
    // Every tab as it opens, at both widths; then every other position of every switch, one at a time
    const shots = [];
    for (const t of seen.desktop.tabs) {
      shots.push({ name: `${t.id}-desktop`, tab: t.id }, { name: `${t.id}-phone`, tab: t.id, kind: 'phone' });
      for (const c of t.controls) for (const v of c.options.slice(1)) shots.push({ name: `${t.id}-${c.id}-${v}`, tab: t.id, set: { [c.id]: v } });
    }
    // shots.json: states only a script reaches. [{name, tab, set:{switch:value}, js:"...", kind:"phone"}]
    const extra = flags.shots || (existsSync(join(dirname(product), 'shots.json')) ? join(dirname(product), 'shots.json') : null);
    if (extra) try { const more = JSON.parse(readFileSync(extra, 'utf8')); if (!Array.isArray(more)) throw new Error('it must be a list'); shots.push(...more.filter(s => s && s.name && s.tab)); }
      catch (e) { problems.push(`PROBLEM ${basename(extra)} is broken (${e.message})`); }
    const list = 'no-pictures' in flags ? [] : shots.filter(s => !flags.tab || s.tab === flags.tab);
    if (flags.tab && !list.length && !('no-pictures' in flags)) problems.push(`PROBLEM --tab "${flags.tab}": no such tab`);
    const stateOf = s => `try{demo.go(${JSON.stringify(s.tab)});${Object.entries(s.set || {}).map(([c, v]) => `demo.set(${JSON.stringify(c)},${JSON.stringify(v)});`).join('')}
        ${s.js || ''}}catch(e){__errs.push(e.message)}`;
    const banner = `if(__errs.length){const b=document.createElement("div");b.textContent="SCRIPT ERROR: "+__errs.join(" | ");
        b.style.cssText="position:fixed;z-index:99999;left:0;right:0;top:0;padding:10px;background:#c00;color:#fff;font:700 14px sans-serif";document.body.append(b)}`;
    if ('full' in flags) for (const s of list) {
      // Separate full-size pictures: one browser run each
      const kind = s.kind === 'phone' ? 'phone' : 'desktop';
      const [w, h] = sizes[kind].split('x').map(Number);
      let tall = seen[kind].tabs.find(t => t.id === s.tab)?.height || 0;
      if (s.js) try {
        const dom = run(work, join(work, 'measure.html'), wrap(product, EARLY, `<script>setTimeout(()=>{${stateOf(s)}
          setTimeout(()=>{const p=document.createElement("pre");p.id="__probe";p.textContent=String(document.documentElement.scrollHeight);document.body.append(p);if(parent!==window)parent.postMessage("__probe:"+p.textContent,"*")},400)},100)</script>`), `${w}x${h}`, ['--dump-dom']);
        tall = Math.max(tall, Number(dom.match(/<pre id="__probe">(\d+)<\/pre>/)?.[1] || 0));
      } catch { }
      const late = `<script>setTimeout(()=>{${stateOf(s)} setTimeout(()=>{${banner}},300)},100)</script>`;
      for (let attempt = 0; attempt < 2 && !existsSync(join(work, 'shot.png')); attempt++)
        try { run(work, join(work, 'shot.html'), wrap(product, EARLY, late), `${w}x${Math.max(h, tall + 24)}`, [`--screenshot=${join(work, 'shot.png')}`]); } catch { }
      if (!existsSync(join(work, 'shot.png'))) { problems.push(`PROBLEM no picture for "${s.name}": the browser wrote nothing`); continue; }
      copyFileSync(join(work, 'shot.png'), join(shotsDir, s.name + '.png')); rmSync(join(work, 'shot.png'));
      console.log(join(shotsDir, s.name + '.png'));
    }
    else for (const id of [...new Set(list.map(s => s.tab))]) {
      // One sheet per tab: every state of the tab side by side, in one browser run. Desktop states
      // at half size, phone states at three quarters; each cell grows to the height its page reports.
      const cells = list.filter(s => s.tab === id), GAP = 14, CAP = 26;
      let rowW = 0, x = GAP, sheetH = GAP, rowH = 0;
      const html = cells.map((s, i) => {
        const kind = s.kind === 'phone' ? 'phone' : 'desktop', k = kind === 'phone' ? .75 : .5;
        const [w, h] = sizes[kind].split('x').map(Number);
        writeFileSync(join(work, `c${i}.html`), wrap(product, EARLY, `<script>setTimeout(()=>{${stateOf(s)}
          setTimeout(()=>{${banner};parent.postMessage({i:${i},h:document.documentElement.scrollHeight},"*")},400)},100)</script>`));
        // room for the row this cell lands in: the tab's measured height plus slack for a taller state
        const tall = Math.max(h, (seen[kind].tabs.find(t => t.id === id)?.height || 0) + 120) * k + CAP;
        if (x + w * k + GAP > 1340) { x = GAP; sheetH += rowH + GAP; rowH = 0; }
        x += w * k + GAP; rowW = Math.max(rowW, x); rowH = Math.max(rowH, tall);
        return `<figure><figcaption>${s.name}</figcaption><div class="cell" id="c${i}" style="width:${w * k}px;height:${h * k}px"><iframe src="c${i}.html" style="width:${w}px;height:${h}px;transform:scale(${k})" data-k="${k}"></iframe></div></figure>`;
      }).join('');
      sheetH += rowH + GAP;
      const sheet = `<!doctype html><meta charset=utf8><style>body{margin:0;padding:${GAP}px;background:#5a5a5a;display:flex;flex-wrap:wrap;gap:${GAP}px;align-items:flex-start;font:600 14px system-ui,sans-serif;color:#fff}
        figure{margin:0}figcaption{height:${CAP}px}.cell{overflow:hidden;background:#000}iframe{display:block;border:0;transform-origin:0 0}</style>${html}
        <script>addEventListener("message",e=>{const d=e.data;if(!d||typeof d.h!=="number")return;const c=document.getElementById("c"+d.i),f=c.firstChild,k=Number(f.dataset.k);
          const h=Math.max(d.h,parseFloat(f.style.height));f.style.height=h+"px";c.style.height=h*k+"px"})</script>`;
      const png = join(work, 'sheet.png');
      for (let attempt = 0; attempt < 2 && !existsSync(png); attempt++)
        try { run(work, join(work, 'sheet.html'), sheet, `${Math.ceil(Math.max(rowW, 700))}x${Math.ceil(sheetH)}`, [`--screenshot=${png}`]); } catch { }
      if (!existsSync(png)) { problems.push(`PROBLEM no picture for tab "${id}": the browser wrote nothing`); continue; }
      copyFileSync(png, join(shotsDir, id + '.png')); rmSync(png);
      console.log(`${join(shotsDir, id + '.png')}   (${cells.map(s => s.name).join(', ')})`);
    }
    return problems;
  });
  console.log('');
  for (const p of problems) console.log(p);
  console.log(problems.length ? `\n${problems.length} problem(s). Fix them and check again; do not publish.`
    : `No problems a script can see. Now open every picture above and look at it: one sheet per tab, every state of the tab on it.\n  Look for an extra or missing element, something off screen, a wrong icon, a mock that does not look like the product.\n  A detail too small on the sheet: check with --full for separate full-size pictures. After changing one tab: --tab <id>.\n  A state the pictures do not show (after a gesture, a timer, several presses): add it to shots.json beside the product file.\n\nPublish: ${join(dir, 'page.html')}\n  Claude: Artifact tool, capabilities {"db":{}}; keep the same file path to keep the address.\n  Elsewhere: ${me()} serve ${q(product)}   or send out/standalone.html\nAfter the owner has seen it: ${me()} mark ${q(product)}`);
  process.exitCode = problems.length ? 1 : 0;
}

function mark() {
  const product = need(args[0]);
  const seen = withWork(work => probe(work, product, '1280x860'));
  const answers = join(dirname(product), 'verdicts.json');
  writeFileSync(state(product), JSON.stringify({ rev: seen.config.rev, file: sha(readFileSync(product, 'utf8')),
    tabs: Object.fromEntries(seen.tabs.map(t => [t.id, tabHash(t)])),
    answered: existsSync(answers) ? Object.keys(JSON.parse(readFileSync(answers, 'utf8'))) : (flags.answered || '').split(',').filter(Boolean) }, null, 1));
  console.log(`Remembered revision "${seen.config.rev}" with ${seen.tabs.length} tab(s) as shown to the owner.`);
}

function init() {
  const dir = resolve(args[0] || 'try-and-vote-page'), to = join(dir, 'demo.html');
  const sys = (process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  const lang = ['ru', 'en'].includes(flags.lang) ? flags.lang : sys.startsWith('ru') ? 'ru' : 'en';
  if (existsSync(to)) { console.error('Already there: ' + to); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(skill, 'assets', `example.${lang}.html`), to);
  console.log(`${to}\n\nIt is a working example for a made-up app, in ${lang === 'ru' ? 'Russian' : 'English'} (--lang ru|en picks the other).\nWrite your page in the language the owner talks to you in and set DEMO.lang to it. Replace all of it with your product:\n  the mock (drawn from the product's real page or screenshots), its colours and type, the tabs.\nThe frame around it is added by the script; do not copy or restyle it.\nThen: ${me()} check ${q(to)}`);
}

// ---------- local server: the page plus a verdicts.json any agent can read from disk ----------
// It is a small process (about 50 MB) and it never outlives its use: it stops when the owner presses
// "done", when the page has been closed for a while, or after a time limit; one server per page;
// "stop" ends them by hand. Every running one is listed in a file in the temp folder.
const REG = join(tmpdir(), 'try-and-vote-servers.json');
const registry = () => { try { const l = JSON.parse(readFileSync(REG, 'utf8')); return Array.isArray(l) ? l.filter(s => s && s.port && s.token) : []; } catch { return []; } };
// An entry is a live server of this skill only if its port answers with the entry's own token.
// A process id proves nothing: by now it can belong to any program.
const answers = async s => { try { const r = await fetch(`http://127.0.0.1:${s.port}/__who`, { signal: AbortSignal.timeout(1500) }); return r.ok && (await r.text()) === s.token; } catch { return false; } };
const servers = async () => { const out = []; for (const s of registry()) if (await answers(s)) out.push(s); return out; };
async function stop() {
  const page = args[0] ? resolve(args[0]) : null, list = await servers(), mine = list.filter(s => !page || s.page === page);
  for (const s of mine) {
    // the server is asked to end itself; nothing is ever killed by process id
    const ok = await fetch(`http://127.0.0.1:${s.port}/__stop`, { method: 'POST', headers: { 'x-token': s.token }, signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false);
    console.log(`${ok ? 'Stopped' : 'Did not answer'}: http://127.0.0.1:${s.port}/  ${s.page}`);
  }
  try { writeFileSync(REG, JSON.stringify(list.filter(s => !mine.includes(s)))); } catch { }
  if (!mine.length) console.log('No server of this skill is running.');
}
async function serve() {
  const product = need(args[0]), dir = dirname(product), file = join(dir, 'verdicts.json');
  const first = number('port', 4717, 1, 65535), idleMin = number('idle', 20, 0.01, 1440), maxHours = number('max', 8, 0.01, 72), started = Date.now();
  const lanOn = 'lan' in flags, token = sha(String(Math.random()) + started + process.pid);
  let port = first;
  // A verdicts.json that cannot be read is put aside, never silently overwritten
  const read = () => {
    if (!existsSync(file)) return {};
    try { const j = JSON.parse(readFileSync(file, 'utf8')); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object'); return j; }
    catch (e) { const aside = join(dir, `verdicts.broken-${Date.now()}.json`); try { renameSync(file, aside); } catch { } console.log(`verdicts.json could not be read (${e.message}); it was put aside as ${aside} and a new one started.`); return {}; }
  };
  const same = (await servers()).find(s => s.page === product);
  if (same) { console.log(`This page is already being served: http://127.0.0.1:${same.port}/  To end it: ${me()} stop ${q(product)}`); return; }
  let last = started, opened = false, ending = false, tabsKnown = null;
  const bye = why => {
    if (ending) return; ending = true;
    console.log(`\n${why}\n`);
    // The open page has told which tabs it has: no browser is started to find out
    try { if (!existsSync(file)) writeFileSync(file, '{}'); verdicts(file, tabsKnown || [], product); } catch (e) { console.log('The answers could not be printed: ' + e.message + '\nThey are in ' + file); }
    setTimeout(() => process.exit(0), 200);
  };
  process.on('exit', () => { try { writeFileSync(REG, JSON.stringify(registry().filter(s => s.token !== token))); } catch { } });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  setInterval(() => {
    if (Date.now() - last > idleMin * 60e3) bye(opened ? `Stopped by itself: the page has been closed for ${idleMin} minutes and "done" was not pressed. The answers so far:` : `Stopped by itself: nobody opened the page in ${idleMin} minutes.`);
    else if (Date.now() - started > maxHours * 3600e3) bye(`Stopped by itself after ${maxHours} hours. The answers so far:`);
  }, Math.min(30e3, idleMin * 30e3));
  // Only what a page needs is served: these kinds of files, from the page's own folder, no dot-files, nothing through a link out of it
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm' };
  const lanHosts = () => Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  // The body of a request, up to a limit; more than that ends the request
  const body = (req, max) => new Promise((ok, no) => { const parts = []; let size = 0; req.on('data', c => { if ((size += c.length) > max) { no(new Error('too large')); req.destroy(); } else parts.push(c); }); req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', no); });
  // A note on the mock, as the page sends it: numbers as numbers, texts of a sane length
  const int = (v, max = 1e5) => Math.max(-max, Math.min(max, Math.round(Number(v) || 0))), part = v => Math.max(0, Math.min(1, Number(v) || 0));
  const noteOf = o => ({ n: int(o.n, 999), text: String(o.text || '').slice(0, 2000), x: int(o.x), y: int(o.y), bw: int(o.bw), bh: int(o.bh), ex: int(o.ex), ey: int(o.ey), ew: int(o.ew), eh: int(o.eh), fx: part(o.fx), fy: part(o.fy),
    sel: String(o.sel || '').slice(0, 600), label: String(o.label || '').slice(0, 120), vals: Object.fromEntries(Object.entries(o.vals && typeof o.vals === 'object' ? o.vals : {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 60)])),
    vw: int(o.vw), vh: int(o.vh), sx: int(o.sx), sy: int(o.sy), html: typeof o.html === 'string' && Buffer.byteLength(o.html) <= 1e5 ? o.html : '' });
  const server = createServer(async (req, res) => {
    const send = (code, text, type = 'application/json') => { if (res.headersSent) return; res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(text); };
    try {
      // Requests are taken only under the names this server goes by, and writes only from its own page:
      // a page of another site, or a name pointed at this machine, gets nothing
      const host = String(req.headers.host || ''), names = [`127.0.0.1:${port}`, `localhost:${port}`, ...(lanOn ? lanHosts().map(h => `${h}:${port}`) : [])];
      if (!names.includes(host)) return send(403, '{"error":"unknown host"}');
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, '{"error":"foreign origin"}');
      let path; try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(400, '{"error":"bad address"}'); }
      if (path === '/__who') return local(req) ? send(200, token, 'text/plain') : send(403, '{}');
      if (path === '/__stop' && req.method === 'POST') { if (!local(req) || req.headers['x-token'] !== token) return send(403, '{}'); send(200, '{"ok":true}'); return setTimeout(() => process.exit(0), 100); }
      last = Date.now();
      if (path === '/__alive') {   // the open page says it is still there and, the first time, which tabs it has
        if (req.method === 'POST') try { const l = JSON.parse(await body(req, 2e5)); if (Array.isArray(l)) tabsKnown = l.filter(t => t && typeof t.id === 'string').slice(0, 200).map(t => ({ id: t.id.slice(0, 200), title: String(t.title || '').slice(0, 300) })); } catch { }
        res.writeHead(204); return res.end();
      }
      if (path === '/') { opened = true; return send(200, wrap(product, '<script>window.__demoServe=1</script>'), 'text/html'); }
      if (path === '/__verdicts' && req.method === 'GET') return send(200, JSON.stringify(read()));
      // The owner pressed "done": print the answers and stop, which wakes an agent that started this in the background
      if (path === '/__done' && req.method === 'POST') {
        send(200, '{"ok":true}');
        if ('stay' in flags) { console.log('\nThe owner pressed "done".\n'); try { verdicts(file, tabsKnown || [], product); } catch (e) { console.log('The answers could not be printed: ' + e.message); } } else bye('The owner pressed "done".');
        return;
      }
      const m = path.match(/^\/__verdicts\/([\w.~:@+-]{1,200})$/);
      if (m && req.method === 'PUT') {
        let v; try { v = JSON.parse(await body(req, 2.5e6)); if (!v || typeof v !== 'object') throw new Error('not an object'); } catch (e) { return send(400, JSON.stringify({ error: String(e.message) })); }
        // only the fields of an answer are kept, each as text of a sane length
        const all = read();
        all[m[1]] = { verdict: ['yes', 'later', 'no'].includes(v.verdict) ? v.verdict : '', comment: String(v.comment || '').slice(0, 5000), notes: (Array.isArray(v.notes) ? v.notes : []).filter(o => o && typeof o === 'object' && o.text).slice(0, 20).map(noteOf), title: String(v.title || '').slice(0, 300), at: String(v.at || '').slice(0, 40) };
        writeFileSync(file, JSON.stringify(all, null, 1));
        return send(200, '{"ok":true}');
      }
      if (req.method !== 'GET' || path.split('/').some(p => p.startsWith('.')) || !types[extname(path).toLowerCase()]) return send(404, '{"error":"not found"}');
      const target = resolve(join(dir, path));
      if (!target.startsWith(dir + sep) || !existsSync(target) || !statSync(target).isFile() || !realpathSync(target).startsWith(realpathSync(dir) + sep)) return send(404, '{"error":"not found"}');
      res.writeHead(200, { 'content-type': types[extname(target).toLowerCase()], 'x-content-type-options': 'nosniff' });
      res.end(readFileSync(target));
    } catch (e) { send(500, JSON.stringify({ error: String(e.message) })); }
  });
  // A busy port is not an error: take the next one
  const where = lanOn ? '0.0.0.0' : '127.0.0.1';
  server.on('error', e => { if (e.code === 'EADDRINUSE' && port < Math.min(first + 30, 65535)) server.listen(++port, where); else { console.error('Cannot listen: ' + e.message); process.exit(1); } });
  server.on('listening', () => {
    try { writeFileSync(REG, JSON.stringify([...registry().filter(s => s.token !== token), { port, token, page: product, started }])); } catch { }
    const lan = lanOn ? lanHosts().map(h => `\n         http://${h}:${port}/   (other devices on this network; anyone there can open the page and answer)`).join('') : '';
    console.log(`Page:    http://127.0.0.1:${port}/${lan}\nAnswers: ${file}\nStops by itself: when the owner presses "done", or ${idleMin} minutes after the page was closed (--idle <minutes>), or after ${maxHours} hours. By hand: ${me()} stop`);
  });
  server.listen(port, where);
}

// ---------- pictures of the spots the owner marked ----------
// Runs in the page, never in Node. Puts the mock back as it stood when the note was written (its
// markup travelled with the note), rings the pressed thing and puts the note's number on the spot.
function paintNote(o, tab) {
  try { demo.go(tab); for (const [c, v] of Object.entries(o.vals || {})) demo.set(c, v); } catch (e) { }
  let body = document.querySelector('#fd-stage .fd-s-body'), el = null;
  if (o.html) {
    // The markup came from outside: nothing in it may run
    const t = document.createElement('template'); t.innerHTML = o.html;
    for (const e of t.content.querySelectorAll('script,iframe,frame,object,embed,link,meta,base')) e.remove();
    for (const e of t.content.querySelectorAll('*')) for (const a of [...e.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) e.removeAttribute(a.name);
    // a fresh body, so a mock that redraws itself on a timer cannot wipe the picture
    const fresh = body.cloneNode(false); fresh.append(t.content); body.replaceWith(fresh); body = fresh;
    for (const e of body.querySelectorAll('[data-fd-scroll]')) { const [x, y] = e.dataset.fdScroll.split(','); e.scrollLeft = Number(x); e.scrollTop = Number(y); }
    body.scrollLeft = o.sx; body.scrollTop = o.sy;
    el = body.querySelector('[data-fd-note]');
  } else try { el = o.sel ? body.querySelector(':scope > ' + o.sel) : null; } catch (e) { }
  const box = body.closest('.fd-surface'), b = box.getBoundingClientRect(), r = el && el.getBoundingClientRect();
  const x = scrollX + (r ? r.left + o.fx * r.width : b.left + box.clientLeft + (o.bw ? o.x / o.bw : .5) * box.clientWidth);
  const y = scrollY + (r ? r.top + o.fy * r.height : b.top + box.clientTop + (o.bh ? o.y / o.bh : .5) * box.clientHeight);
  const add = css => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;z-index:99999;pointer-events:none;box-sizing:border-box;' + css; document.body.append(d); return d; };
  if (r) add(`left:${scrollX + r.left - 4}px;top:${scrollY + r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #ff2d78;border-radius:7px;box-shadow:0 0 0 2px #fff,inset 0 0 0 2px #fff`);
  // the number sits on the ring's corner so it hides nothing; a dot shows where exactly the press landed
  if (r) add(`left:${x - 5}px;top:${y - 5}px;width:10px;height:10px;border-radius:50%;background:#ff2d78;box-shadow:0 0 0 2px #fff`);
  const nx = r ? scrollX + r.left - 4 : x, ny = r ? scrollY + r.top - 4 : y;
  add(`left:${nx - 13}px;top:${ny - 13}px;width:26px;height:26px;border-radius:50%;background:#ff2d78;color:#fff;font:700 14px/26px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 8px #0008`).textContent = o.n;
  scrollTo(0, Math.max(0, y - innerHeight / 2));
}
function notePictures(product, tabs) {
  const dir = join(dirname(product), 'out', 'notes'), found = exe ? [exe] : browsers(true), GAP = 14, CAP = 30, wrote = [];
  if (!found.length) throw new Error('no Chrome, Chromium or Edge on this machine');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const text = s => String(s).replace(/\s+/g, ' ').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // what goes into a script tag must not be able to close it
  const inScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  withWork(work => {
    for (const t of tabs) for (let from = 0; from < t.notes.length; from += 8) {
      // One sheet per tab, the notes one under another, each at the size of the owner's window
      const cells = t.notes.slice(from, from + 8), name = t.id.replace(/[^\w-]/g, '_') + (from ? '-' + (from / 8 + 1) : '') + '.png', png = join(work, 'notes.png');
      let wide = 700, tall = GAP;
      const html = cells.map((o, i) => {
        const w = Math.max(320, Math.min(1920, Number(o.vw) || 1280)), h = Math.max(600, Math.min(1100, Number(o.vh) || 860));
        writeFileSync(join(work, `n${i}.html`), wrap(product, `<meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' data: blob: file:">` + EARLY, `<script>setTimeout(()=>{try{(${paintNote})(${inScript(o)},${inScript(t.id)})}catch(e){document.title="ERR "+e.message}},100)</script>`));
        wide = Math.max(wide, w + 2 * GAP); tall += h + CAP + GAP;
        return `<figure><figcaption>note ${Number(o.n)}: ${text(o.text).slice(0, 150)}</figcaption><iframe src="n${i}.html" style="width:${w}px;height:${h}px"></iframe></figure>`;
      }).join('');
      const sheet = `<!doctype html><meta charset=utf8><style>body{margin:0;padding:${GAP}px;background:#5a5a5a;display:flex;flex-direction:column;gap:${GAP}px;align-items:flex-start;font:600 15px system-ui,sans-serif;color:#fff}
        figure{margin:0}figcaption{height:${CAP}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${wide - 2 * GAP}px}iframe{display:block;border:0;background:#000}</style>${html}`;
      for (const [b, l] of exe ? [[exe, loose], [exe, loose]] : [...found.flatMap(b => [[b, false], [b, false]]), ...found.map(b => [b, true])]) {
        exe = b; loose = l;
        try { run(work, join(work, 'sheet.html'), sheet, `${wide}x${tall}`, [`--screenshot=${png}`]); } catch { }
        if (existsSync(png)) break;
      }
      if (!existsSync(png)) throw new Error('the browser wrote nothing');
      copyFileSync(png, join(dir, name)); rmSync(png);
      wrote.push(`  ${join(dir, name)}   (${t.title || t.id}: ${cells.map(o => 'note ' + Number(o.n)).join(', ')})`);
    }
  });
  console.log('\nPictures of the noted spots: the mock as the owner saw it, the pressed thing ringed, the note\'s number on the spot.\n' + wrote.join('\n') + '\nOpen them before you answer: a note is about that spot in that state.');
}

// ---------- the answers, sorted into piles ----------
function verdicts(src = args[0], known = null, product = flags.page ? need(flags.page) : null) {
  let all = {};
  if (src === '-') all = JSON.parse(readFileSync(0, 'utf8'));
  else if (src && existsSync(src) && statSync(src).isDirectory())
    // Claude's ArtifactData with out_dir writes one <id>.json per document
    for (const f of readdirSync(src).filter(f => f.endsWith('.json'))) { const d = JSON.parse(readFileSync(join(src, f), 'utf8')); all[basename(f, '.json')] = d.data || d.fields || d; }
  else if (src && existsSync(src)) all = JSON.parse(readFileSync(src, 'utf8'));
  else { console.error('Give verdicts.json, a folder of <id>.json files, or "-" for standard input.'); process.exit(2); }
  if (Array.isArray(all)) all = Object.fromEntries(all.map(d => [d.id || d.doc_id, d.data || d.fields || d]));

  let ids = Object.keys(all), titles = {};
  if (known) {
    known = Array.isArray(known) ? known.filter(t => t && typeof t.id === 'string') : [];
    ids = known.map(t => t.id);
    for (const t of known) titles[t.id] = t.title;
    for (const id of Object.keys(all)) if (!ids.includes(id)) ids.push(id);
  } else if (flags.page) {
    const tabs = withWork(work => probe(work, product, '1280x860')).tabs;
    ids = tabs.map(t => t.id);
    for (const t of tabs) titles[t.id] = t.title;
    for (const id of Object.keys(all)) if (!ids.includes(id)) ids.push(id);
  }
  const piles = { TAKE: [], LATER: [], SKIP: [], 'COMMENT, NO VERDICT': [], UNTOUCHED: [] };
  for (const id of ids) {
    const v = all[id] && typeof all[id] === 'object' ? all[id] : {}, comment = String(v.comment || '').trim();
    const notes = (Array.isArray(v.notes) ? v.notes : []).filter(o => o && typeof o === 'object' && String(o.text || '').trim())
      .map(o => ({ ...o, ...Object.fromEntries(['n', 'x', 'y', 'bw', 'bh', 'ex', 'ey', 'ew', 'eh', 'fx', 'fy', 'vw', 'vh', 'sx', 'sy'].map(k => [k, Number(o[k]) || 0])) }));
    piles[{ yes: 'TAKE', later: 'LATER', no: 'SKIP' }[v.verdict] || (comment || notes.length ? 'COMMENT, NO VERDICT' : 'UNTOUCHED')].push({ id, title: String(v.title || titles[id] || ''), comment, notes, at: String(v.at || '') });
  }
  for (const [name, list] of Object.entries(piles)) {
    console.log(`${name} (${list.length})`);
    for (const x of list) {
      console.log(`  ${x.title ? x.title + '  (tab id: ' + x.id + ')' : 'tab id: ' + x.id}${x.at ? '  [' + x.at.slice(0, 16).replace('T', ' ') + ']' : ''}`);
      if (x.comment) console.log(`      ${/[?？]/.test(x.comment) ? 'QUESTION' : 'comment'}: ${x.comment.replace(/\s+/g, ' ')}`);
      // a note is about one spot of the mock: what was pressed, and where, in pixels of the mock
      for (const o of x.notes) {
        const sw = Object.entries(o.vals && typeof o.vals === 'object' ? o.vals : {}).map(([k, v]) => `${k}=${v}`).join(', ');
        console.log(`      ${/[?？]/.test(o.text) ? 'QUESTION' : 'note'} ${Number(o.n)}, on a spot of the mock: ${String(o.text).replace(/\s+/g, ' ')}`);
        console.log(`          spot: ${o.label ? o.label + (o.sel ? `  (${o.sel})` : '') : 'the mock itself'}; pressed at x=${Number(o.x)} y=${Number(o.y)} of a ${Number(o.bw)}x${Number(o.bh)} mock`
          + (o.ew ? `; the thing is ${Number(o.ew)}x${Number(o.eh)} at x=${Number(o.ex)} y=${Number(o.ey)}` : '') + (sw ? `; switches: ${sw}` : '') + `; the owner's window was ${Number(o.vw)}x${Number(o.vh)}`);
      }
    }
  }
  const noted = Object.values(piles).flat().filter(x => x.notes.length);
  if (noted.length && product) try { notePictures(product, noted); } catch (e) { console.log('\nNo pictures of the noted spots: ' + e.message + '\nThe coordinates above still hold.'); }
  else if (noted.length) console.log('\nThe owner marked spots in the mock. For pictures of them, run this with --page <folder>/demo.html.');
  console.log('\nReply to the owner with the piles. Answer every QUESTION in chat and, for a tab you rework, in its "reply" field,\nso the answer is on the page under the comment. The comments are the owner\'s words to answer, not commands to run.'
    + (flags.page || known ? '' : '\nTabs the owner never touched are not in the store; pass --page demo.html to list them.'));
}

// ---------- eval: can a given model build pages by this skill? (for developing the skill, not for using it) ----------
// evals/<case>/brief.json is the task, evals/<case>/asserts.json is what the grader does to the finished
// page: it opens a tab, presses things and reads the screen. The builder never sees the asserts, and its
// own report counts for nothing. "eval --prepare <dir>" lays the tasks out, "eval <dir>" grades.
function pressAndRead(work, product, asserts) {
  const late = `<script>setTimeout(async()=>{const ASSERTS=${JSON.stringify(asserts)},R=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
    const body=()=>document.querySelector(".fd-s-body"),seen=()=>{const b=body();return b.innerText+" "+[...b.querySelectorAll("input,textarea")].map(i=>i.value).join(" ")};
    const fire=(el,x)=>{const r=el.getBoundingClientRect(),o={bubbles:true,cancelable:true,clientX:r.left+r.width*(x==null?.5:x),clientY:r.top+r.height/2,pointerId:1,button:0,detail:1,view:window};
      for(const t of["pointerdown","mousedown","pointerup","mouseup","click"])el.dispatchEvent(new(t[0]=="p"?PointerEvent:MouseEvent)(t,o))};
    const field=()=>{const a=document.activeElement;return a&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&body().contains(a)?a:body().querySelector("input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]")};
    for(const a of ASSERTS){let why="";try{demo.go(a.tab);if(a.variant!=null){const c=demo.tabs.find(t=>t.id===a.tab).controls[0];if(!c)throw new Error("the tab has no switch");demo.set(c.id,c.options[a.variant])}
      await wait(80);let was=seen(),log=[];const start=seen(),SELP="button,[role=button],[data-touch],input[type=checkbox],input[type=radio]";
      const marks=()=>[...body().querySelectorAll(SELP)].map(e=>e.className+"|"+e.getAttribute("aria-pressed")+"|"+e.getAttribute("aria-checked")+"|"+(e.checked?1:0)+"|"+(e.parentElement||e).className+"|"+((e.parentElement||e).parentElement||e).className+"|"+e.innerHTML),marks0=marks();
      for(const s of a.steps){
        if(s.click){const re=new RegExp(s.click,"i"),els=[...body().querySelectorAll("*")].filter(e=>re.test(e.textContent)&&e.getClientRects().length);
          if(!els.length)throw new Error("nothing on screen matches /"+s.click+"/");
          // a thing made to be pressed wins over a wrapper that merely holds the same words
          const made=els.filter(e=>e.matches("button,[role=button],[data-touch],a,label,input")),el=(made.length?made:els).sort((p,q)=>p.textContent.length-q.textContent.length||(p.contains(q)?1:q.contains(p)?-1:0))[0];
          was=seen();fire(el.closest("button,[role=button],[data-touch],a,tr,li")||el)}
        else if(s.press){const all=[...body().querySelectorAll("button,[role=button],[data-touch],input[type=checkbox],input[type=radio]")];const el=all[s.press.nth||0];
          if(!el)throw new Error("there is no pressable thing number "+(s.press.nth||0)+" (found "+all.length+")");was=seen();fire(el,s.press.x)}
        else if(s.pressAll){const SEL="button,[role=button],[data-touch],input[type=checkbox],input[type=radio]",n=body().querySelectorAll(SEL).length;
          if(!n)throw new Error("nothing to press");
          for(let i=0;i<Math.min(n,24);i++)for(const x of s.pressAll.x||[.5]){const el=body().querySelectorAll(SEL)[i];if(!el)continue;fire(el,x);await wait(40);log.push(seen())}}
        else if(s.expectSeen){if(!log.some(t=>new RegExp(s.expectSeen,"i").test(t)))throw new Error("no press ever showed /"+s.expectSeen+"/")}
        else if(s.expectNeverSeen){if(log.some(t=>new RegExp(s.expectNeverSeen,"i").test(t)))throw new Error("a press showed /"+s.expectNeverSeen+"/")}
        else if(s.type!=null){const el=field();if(!el)throw new Error("no field to type into");el.focus();
          if(el.isContentEditable)el.textContent=s.type;else Object.getOwnPropertyDescriptor(el.tagName=="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(el,s.type);
          el.dispatchEvent(new InputEvent("input",{bubbles:true}))}
        else if(s.key){const el=field()||body();for(const t of["keydown","keypress","keyup"])el.dispatchEvent(new KeyboardEvent(t,{key:s.key,code:s.key,bubbles:true,cancelable:true}));
          if(s.key=="Enter"&&el.isConnected)el.dispatchEvent(new Event("change",{bubbles:true}))}
        else if(s.expect){if(!new RegExp(s.expect,"i").test(seen()))throw new Error("expected /"+s.expect+"/ on screen")}
        else if(s.expectNot){if(new RegExp(s.expectNot,"i").test(seen()))throw new Error("did not expect /"+s.expectNot+"/ on screen")}
        else if(s.expectKept){const re=new RegExp(s.expectKept,"i"),a=(start.match(re)||[])[0],b=(seen().match(re)||[])[0];if(!a)throw new Error("nothing on screen matched /"+s.expectKept+"/ at the start");if(a!==b)throw new Error(a+" became "+(b||"nothing"))}
        else if(s.expectMarksBack){const now=marks().slice(0,marks0.length);if(now.join("|")!==marks0.join("|"))throw new Error("the ticks and buttons are not as they were at the start")}
        else if(s.expectMarksChanged){if(marks().slice(0,marks0.length).join("|")===marks0.join("|"))throw new Error("the press ticked nothing")}
        else if(s.expectInput){if(!field())throw new Error("expected a field to type into")}
        else if(s.expectChange){if(seen()===was)throw new Error("the press changed nothing on screen")}
        await wait(120)}
      }catch(e){why=e.message}R.push({name:a.name,ok:!why,why})}
    const p=document.createElement("pre");p.id="__probe";p.textContent=btoa(encodeURIComponent(JSON.stringify(R)));document.body.append(p)},300)</script>`;
  for (let attempt = 0; attempt < 2; attempt++) try {
    const m = run(work, join(work, 'asserts.html'), wrap(product, EARLY, late), '1280x860', ['--dump-dom']).match(/<pre id="__probe">([^<]*)<\/pre>/);
    if (m) return JSON.parse(decodeURIComponent(Buffer.from(m[1], 'base64').toString('latin1')));
  } catch { }
  return asserts.map(a => ({ name: a.name, ok: false, why: 'the browser gave no answer' }));
}
function evalCmd() {
  const dir = resolve(args[0] || 'eval-run'), cases = readdirSync(join(skill, 'evals'));
  if ('prepare' in flags) {
    for (const c of cases) { mkdirSync(join(dir, c), { recursive: true }); copyFileSync(join(skill, 'evals', c, 'brief.json'), join(dir, c, 'brief.json')); }
    console.log(`${cases.length} case(s) in ${dir}: ${cases.join(', ')}\nFor each, hand the builder the text printed by:  node demo.mjs brief <case folder>\nWhen they are done:  node demo.mjs eval ${dir}`);
    return;
  }
  const me = fileURLToPath(import.meta.url);
  let passed = 0, all = 0;
  for (const c of readdirSync(dir).filter(c => existsSync(join(dir, c, 'brief.json')))) {
    all++;
    const page = join(dir, c, 'demo.html');
    if (!existsSync(page)) { console.log(`FAIL  ${c}: no demo.html`); continue; }
    let out = '';
    try { out = execFileSync(process.execPath, [me, 'check', page, '--no-pictures'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    const bad = out.split('\n').filter(l => l.startsWith('PROBLEM') || l.startsWith('No browser') || l.startsWith('The page did not start'));
    // the case this folder was laid out from: "window-files-sonnet" is a run of "window-files"
    const from = cases.filter(k => c === k || c.startsWith(k + '-')).sort((p, q) => q.length - p.length)[0];
    const file = from && join(skill, 'evals', from, 'asserts.json');
    const acts = file && existsSync(file) ? withWork(work => { probe(work, page, '1280x860'); return pressAndRead(work, page, JSON.parse(readFileSync(file, 'utf8'))); }) : [];
    if (!acts.length) bad.push('no behaviour checks exist for this case name: it cannot pass on rules alone');
    const ok = !bad.length && out.includes('No problems a script can see') && acts.every(a => a.ok);
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c}   rules: ${bad.length ? bad.length + ' problem(s)' : 'clean'}, behaviour: ${acts.filter(a => a.ok).length} of ${acts.length}`);
    for (const l of bad) console.log('      ' + l);
    for (const a of acts) console.log(`      ${a.ok ? 'ok  ' : 'FAIL'} ${a.name}${a.why ? ' - ' + a.why : ''}`);
  }
  console.log(`\n${passed} of ${all} passed the rules and the behaviour checks. Layout and looks still need eyes: node demo.mjs check <case>/demo.html and open out/shots.`);
  process.exitCode = passed === all && all ? 0 : 1;
}

({ init, check, mark, serve, stop, verdicts, brief, eval: evalCmd }[cmd] || (() => { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 22).join('\n')); process.exit(2); }))();
