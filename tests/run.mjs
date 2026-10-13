// Tests of the script itself: node tests/run.mjs [--fast]
// 1. The rules: a good page passes, and each broken page gets the PROBLEM line it deserves.
// 2. The server: it stops by itself when nobody opens the page, refuses to run twice for one
//    page, and "stop" ends it.
// For developing the skill. Using the skill needs none of this.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), D = join(root, 'scripts', 'demo.mjs');
const work = mkdtempSync(join(tmpdir(), 'tav-test-'));
const good = readFileSync(join(root, 'assets', 'example.en.html'), 'utf8').replace("key:'leika-candidates'", "key:'test-page'");
let failed = 0;
const say = (ok, name, why = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${why ? '\n       ' + why : ''}`); };
const run = (args, opts = {}) => { try { return execFileSync(process.execPath, [D, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };

// ---------- the rules ----------
// [name, how to break the good page, what the check must say; null = must pass]
const cases = [
  ['a good page passes', s => s, null],
  ['an empty "what to press"', s => s.replace(/do:'Tick the plants[^']*'/, "do:''"), '"do" is empty'],
  ['a description that is an essay', s => s.replace("desc:'When you water", "desc:'" + 'Very long text. '.repeat(20) + "When you water"), 'characters, the limit is'],
  ['texts in another language than the page says', s => s.replace("lang:'en'", "lang:'ru'"), 'the texts are not in Russian'],
  ['a mock that draws nothing', s => s.replace("mount:scheduleScreen", "mount:() => {}"), 'drew nothing'],
  ['buttons that do nothing', s => s.replace("mount:scheduleScreen", "mount:stage => { stage.innerHTML = '<button>Press me</button>'; }"), 'none of them changes anything'],
  ['a mock wider than a phone', s => s.replace("mount:scheduleScreen", "mount:stage => { stage.innerHTML = '<button style=\"width:900px\">Wide</button>'; stage.firstChild.onclick = e => { e.target.textContent += '!'; }; }").replace("id:'heat',", "id:'heat',surface:'bare',"), 'scrolls sideways at phone width'],
  ['an unknown surface for the whole page', s => s.replace("surface:'phone',", "surface:'watch',"), 'surface "watch" is unknown'],
  ['an unknown surface on a tab', s => s.replace("id:'heat',", "id:'heat',surface:'watch',"), 'surface "watch" is unknown'],
  ['the example left in place', s => s.replace("key:'test-page'", "key:'leika-candidates'"), 'the example product is still in the file'],
];
const fast = process.argv.includes('--fast');
for (const [name, breakIt, want] of fast ? [] : cases) {   // --fast: only the server, no browser
  const page = join(work, 'demo.html');
  writeFileSync(page, breakIt(good));
  const args = ['check', page, '--no-pictures'];
  if (!name.startsWith('the example')) args.push('--example');
  const out = run(args), problems = out.split('\n').filter(l => l.startsWith('PROBLEM'));
  if (want === null) say(!problems.length && out.includes('No problems a script can see'), name, problems.join(' | ') || (out.includes('No problems') ? '' : out.slice(-200)));
  else say(problems.some(p => p.includes(want)), name, problems.some(p => p.includes(want)) ? '' : `wanted "${want}", got: ${problems.join(' | ') || out.slice(-200)}`);
}

// ---------- the server ----------
const page = join(work, 'demo.html');
writeFileSync(page, good);
const wait = ms => new Promise(r => setTimeout(r, ms));
{
  const t0 = Date.now(), out = run(['serve', page, '--port', '4790', '--idle', '0.05'], { timeout: 60000 });
  say(out.includes('nobody opened the page') && Date.now() - t0 < 30000, 'the server stops by itself when nobody opens the page', out.includes('nobody opened') ? '' : out.slice(-300));
}
{
  const child = spawn(process.execPath, [D, 'serve', page, '--port', '4790'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = ''; child.stdout.on('data', d => { said += d; });
  for (let i = 0; i < 40 && !said.includes('Page:'); i++) await wait(250);
  const port = (said.match(/127\.0\.0\.1:(\d+)/) || [])[1];
  const again = run(['serve', page, '--port', '4790'], { timeout: 20000 });
  say(again.includes('already being served'), 'a second server for the same page is refused', again.slice(0, 200));
  if (port) await fetch(`http://127.0.0.1:${port}/__alive`, { method: 'POST', body: JSON.stringify([{ id: 'all', title: 'Water all' }, { id: 'heat', title: 'Heat' }]) }).catch(() => {});
  const answer = port ? await fetch(`http://127.0.0.1:${port}/__verdicts/all`, { method: 'PUT', body: JSON.stringify({ verdict: 'later', comment: 'Проверка: а это сохранится?', title: 't', at: new Date().toISOString() }) }).then(r => r.ok, () => false) : false;
  const kept = answer && JSON.parse(readFileSync(join(work, 'verdicts.json'), 'utf8')).all.comment === 'Проверка: а это сохранится?';
  say(kept, 'an answer reaches verdicts.json, Cyrillic intact');
  const closed = new Promise(r => child.on('exit', r));
  const t1 = Date.now();
  const done = port ? await fetch(`http://127.0.0.1:${port}/__done`, { method: 'POST' }).then(r => r.ok, () => false) : false;
  const gone = await Promise.race([closed.then(() => true), wait(8000).then(() => false)]);
  say(done && gone && said.includes('LATER (1)') && said.includes('QUESTION') && said.includes('UNTOUCHED (1)'), '"done" prints the piles and ends the server within seconds', gone ? `${Date.now() - t1} ms` : 'the server kept running');
  if (!gone) child.kill();
}
{
  const child = spawn(process.execPath, [D, 'serve', page, '--port', '4790'], { stdio: 'ignore' });
  const closed = new Promise(r => child.on('exit', r));
  await wait(2500);
  const out = run(['stop', page]);
  const gone = await Promise.race([closed.then(() => true), wait(8000).then(() => false)]);
  say(out.includes('Stopped:') && gone, '"stop" ends the server', out);
  if (!gone) child.kill();
}
{
  // what the server must refuse
  writeFileSync(join(work, '.secret'), 'no');
  writeFileSync(join(work, 'notes.txt'), 'no');
  const child = spawn(process.execPath, [D, 'serve', page, '--port', '4790'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let said = ''; child.stdout.on('data', d => { said += d; });
    for (let i = 0; i < 40 && !said.includes('Page:'); i++) await wait(250);
    const port = (said.match(/127\.0\.0\.1:(\d+)/) || [])[1], u = `http://127.0.0.1:${port}`;
    const code = (path, init) => fetch(u + path, init).then(r => r.status, () => 0);
    say(await code('/%') === 400 && await code('/') === 200, 'a malformed address gets an error and the server lives on');
    say(await code('/.secret') === 404 && await code('/notes.txt') === 404 && await code('/verdicts.json') === 404, 'dot-files and files a page has no use for are not served');
    say(await code('/__done', { method: 'POST', headers: { origin: 'http://evil.example' } }) === 403, 'a write from another site is refused');
    say(await code('/__stop', { method: 'POST', headers: { 'x-token': 'guess' } }) === 403 && await code('/') === 200, 'stop without the server\'s own token is refused');
    say(await code('/__verdicts/all', { method: 'PUT', body: 'x'.repeat(3e6) }) !== 200 && await code('/') === 200, 'an oversized answer is refused and the server lives on');
    await fetch(u + '/__verdicts/all', { method: 'PUT', body: JSON.stringify({ verdict: 'maybe', comment: 7, at: 5, extra: 'x' }) });
    const kept = JSON.parse(readFileSync(join(work, 'verdicts.json'), 'utf8')).all;
    say(kept.verdict === '' && kept.comment === '7' && kept.at === '5' && !('extra' in kept), 'an answer is stored as an answer: known fields, as text');
    await fetch(u + '/__verdicts/all', { method: 'PUT', body: JSON.stringify({ verdict: 'yes', notes: [{ n: 1, text: 'Too small?', x: '12', y: 30, bw: 300, bh: 500, label: 'button "Go"', vals: { mode: 'new' }, html: '<button data-fd-note>Go</button>', extra: 1 }, { n: 2 }, 'junk'] }) });
    const noted = JSON.parse(readFileSync(join(work, 'verdicts.json'), 'utf8')).all.notes;
    say(noted.length === 1 && noted[0].x === 12 && noted[0].html.includes('data-fd-note') && !('extra' in noted[0]), 'a note on the mock is stored with its spot; a note without text is not');
    const piles = run(['verdicts', join(work, 'verdicts.json')]);
    say(piles.includes('QUESTION 1, on a spot of the mock: Too small?') && piles.includes('pressed at x=12 y=30 of a 300x500 mock') && piles.includes('switches: mode=new'), 'the answers name the noted spot and its coordinates', piles.slice(0, 300));
  } finally { run(['stop', page]); child.kill(); }
}
if (!fast) {
  const out = run(['verdicts', join(work, 'verdicts.json'), '--page', page]);
  say(out.includes('Pictures of the noted spots') && existsSync(join(work, 'out', 'notes', 'all.png')), 'a noted spot gets a picture', out.includes('Pictures of') ? '' : out.slice(-300));
}
{
  const bad = run(['serve', page, '--port', 'nope'], { timeout: 20000 });
  say(bad.includes('--port must be a number'), 'a port that is not a number is refused with a plain message', bad.slice(0, 200));
}

rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(failed ? `\n${failed} test(s) failed.` : '\nAll tests passed.');
process.exit(failed ? 1 : 0);
