#!/usr/bin/env node
// Prints "The Daily Royston": a newspaper front page built from live GitHub
// activity, written to assets/front-page.svg (desktop) and
// assets/front-page-mobile.svg (phones). Runs daily via GitHub Actions.
//
//   node scripts/build-paper.mjs                 # fetch live data
//   GITHUB_TOKEN=... node scripts/build-paper.mjs  # same, higher rate limit

import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.PAPER_USER ?? 'roystondz';
const SURNAME = 'Dsouza';
const CONTACT = 'roystonad2004@gmail.com';
const OUT_DIR = process.env.PAPER_OUT_DIR ?? 'assets';
const TOKEN = process.env.PAPER_TOKEN;

const DAY = 864e5;
const now = new Date(process.env.PAPER_DATE ?? Date.now());

// ------------------------------------------------------------------ data

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'the-daily-royston',
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  if (res.status === 409) return []; // empty repository
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — GET ${path}`);
  return res.json();
}

async function fetchData() {
  const since = new Date(now - 14 * DAY);
  const [user, allRepos] = await Promise.all([
    api(`/users/${USER}`),
    api(`/users/${USER}/repos?per_page=100&sort=pushed&type=owner`),
  ]);
  const repos = allRepos.filter((r) => !r.fork && r.name.toLowerCase() !== USER.toLowerCase());
  const active = repos.filter((r) => new Date(r.pushed_at) >= since).slice(0, 8);

  const commits = await Promise.all(
    active.map(async (r) => {
      const list = await api(`/repos/${USER}/${r.name}/commits?author=${USER}&since=${since.toISOString()}&per_page=100`);
      return list.map((c) => ({
        repo: r.name,
        language: r.language,
        date: new Date(c.commit.author.date),
        message: c.commit.message.split('\n')[0],
      }));
    }),
  );

  return {
    name: user.name ?? USER,
    createdAt: new Date(user.created_at),
    followers: user.followers,
    publicRepos: user.public_repos,
    stars: repos.reduce((n, r) => n + r.stargazers_count, 0),
    repos,
    commits: commits.flat().sort((a, b) => b.date - a.date),
  };
}

// ----------------------------------------------------------------- story

const dayNo = Math.floor(now / DAY);
const pick = (arr, salt = 0) => arr[(dayNo + salt) % arr.length];
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function roman(n) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function ago(date) {
  const d = Math.floor((now - date) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

function languageShares(commits) {
  const counts = {};
  for (const c of commits) counts[c.language ?? 'Other'] = (counts[c.language ?? 'Other'] ?? 0) + 1;
  const total = commits.length || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / total) * 100]));
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function buildStory(d) {
  const weekAgo = new Date(now - 7 * DAY);
  const thisWeek = d.commits.filter((c) => c.date >= weekAgo);
  const lastWeek = d.commits.filter((c) => c.date < weekAgo);

  const byRepo = {};
  for (const c of thisWeek) byRepo[c.repo] = (byRepo[c.repo] ?? 0) + 1;
  const ranked = Object.entries(byRepo).sort((a, b) => b[1] - a[1]);
  const [topRepo, topCount] = ranked[0] ?? [];

  const shares = languageShares(thisWeek);
  const prevShares = languageShares(lastWeek);
  const markets = Object.keys({ ...shares, ...prevShares })
    .map((lang) => ({ lang, share: shares[lang] ?? 0, change: (shares[lang] ?? 0) - (prevShares[lang] ?? 0) }))
    .filter((m) => m.share > 0)
    .sort((a, b) => b.share - a.share || a.change - b.change)
    .slice(0, 5);
  const [lang1, lang2] = markets.filter((m) => m.share > 0);

  const n = thisWeek.length;
  const delta = lastWeek.length ? Math.round(((n - lastWeek.length) / lastWeek.length) * 100) : null;
  const latest = thisWeek[0] ?? d.commits[0];
  const R = topRepo?.toUpperCase();

  let headline, deck;
  if (!n) {
    headline = pick([
      'QUIET WEEK AT THE WORKSHOP; INSIDERS SAY SOMETHING BIG IS BREWING',
      'NO COMMITS FILED THIS WEEK AS DEVELOPER GOES DARK ON SECRET PROJECT',
      'MARKETS FLAT AS DSOUZA STEPS AWAY FROM THE KEYBOARD',
    ]);
    deck = latest
      ? `The last dispatch, filed ${ago(latest.date)} to ${latest.repo}, read simply: “${latest.message}.” Observers are watching closely.`
      : 'Repositories sit idle, terminals dark. Analysts expect activity to resume without warning.';
  } else {
    headline = delta !== null && delta >= 50 && n >= 5
      ? `COMMITS SURGE ${delta}% AS WORK ON ${R} ACCELERATES`
      : pick([
          `${SURNAME.toUpperCase()} PUSHES ${plural(topCount, 'COMMIT')} TO ${R}`,
          `${R} SEES ${plural(topCount, 'NEW COMMIT')} IN BUSY WEEK`,
          `DEVELOPER SPOTTED SHIPPING ${plural(topCount, 'COMMIT')} TO ${R}`,
        ]);
    deck = `Latest dispatch from ${latest.repo} reads “${latest.message}”. ${pick([
      'Sources close to the developer call it “a step in the right direction.”',
      'Colleagues describe the change as “long overdue.”',
      'Experts say more is on the way.',
    ], 1)}`;
  }


  const surge = n > 0 && headline.startsWith('COMMITS SURGE');
  const recent = d.repos.slice(0, 3).map((r) => r.name);
  const paragraphs = [];
  if (n) {
    const trend = surge || delta === null ? ''
      : delta === 0 ? ', level with the week before'
      : `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}% on the week before`;
    paragraphs.push(
      `${d.name}, the full-stack developer behind ${listJoin(recent)}, logged ${plural(n, 'commit')} this week across ${plural(ranked.length, 'repository', 'repositories')}${trend}.`,
    );
    paragraphs.push(
      `When reached for comment, ${SURNAME} said only that the project was “one more refactor away” from done. Readers hoping to collaborate are directed to the classifieds.`,
    );
  } else {
    paragraphs.push(
      `${d.name}, the full-stack developer behind ${listJoin(recent)}, filed no public commits this week. Previous editions have noted that such silences tend to precede a launch.`,
    );
    paragraphs.push('Readers are advised to keep an eye on the workshop below. Those hoping to collaborate are directed to the classifieds.');
  }

  const forecast = lang1
    ? `${Math.round(lang1.share)}% chance of ${lang1.lang}${lang2 ? `, with scattered ${lang2.lang} showers clearing ahead of the Friday deploy.` : '. Clear skies through the weekend.'}`
    : 'Clear skies. Light refactoring possible later in the week.';

  const ticker = [
    `COMMITS THIS WEEK ${n}${delta === null ? '' : delta >= 0 ? ` ▲ ${delta}%` : ` ▼ ${Math.abs(delta)}%`}`,
    `PUBLIC REPOS ${d.publicRepos}`,
    `STARS ★ ${d.stars}`,
    `FOLLOWERS ${d.followers}`,
  ];

  const years = Math.floor((now - d.createdAt) / (365.25 * DAY)) + 1;
  const date = (opts) => now.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' }).toUpperCase();
  return {
    volume: `VOL. ${roman(years)}  ·  NO. ${Math.floor((now - d.createdAt) / DAY).toLocaleString('en-US')}`,
    dateLong: date({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dateShort: date({ year: 'numeric', month: 'short', day: 'numeric' }),
    filed: now.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
    headline, deck, paragraphs, markets, forecast, ticker,
    classified: `Wanted: interesting problems and ambitious teams. Write to ${CONTACT}.`,
    workshop: d.repos.slice(0, 3).map((r) => ({
      name: r.name,
      meta: [r.language, r.stargazers_count && `★ ${r.stargazers_count}`, ago(new Date(r.pushed_at))].filter(Boolean).join('  ·  '),
      language: r.language,
      description: r.description ?? 'No description on file. Our reporters are investigating.',
    })),
  };
}

// ---------------------------------------------------------------- render

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INK = '#1b1a17';
const MUTED = '#5e5a51';
const PAPER = '#f5f0e4';
const RED = '#b3261e';
const GREEN = '#1e6b3a';
const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#e0b500', Python: '#3572a5', Swift: '#f05138', HTML: '#e34c26',
  CSS: '#563d7c', Java: '#b07219', Go: '#00add8', Rust: '#dea584', Kotlin: '#a97bff', Dart: '#00b4ab',
};

// Two layouts, each drawn at the width GitHub displays it, so type is never
// scaled down: ~730px in the desktop README column, ~343px on phones.
const LAYOUTS = {
  desktop: {
    W: 710, M: 32, mast: 64, head: 36, headLh: 42, deck: 18, deckLh: 26, body: 16, bodyLh: 25,
    side: 200, gutter: 30,
  },
  mobile: {
    W: 340, M: 18, mast: 34, head: 25, headLh: 30, deck: 16, deckLh: 22, body: 15, bodyLh: 23,
    side: 0, gutter: 0,
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Greedy word wrap using an average glyph width (em) for the font.
function wrap(text, size, width, em, widths = []) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    const max = widths[lines.length] ?? width;
    if (line && next.length * size * em > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// One line of text; squeezed with textLength only if it would overflow.
function line(text, { x, y, w, size, em, cls, anchor }) {
  const fit = text.length * size * em > w ? ` textLength="${w}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" class="${cls}"${anchor ? ` text-anchor="${anchor}"` : ''}${fit}>${esc(text)}</text>`;
}

// A wrapped, ragged-right paragraph. (SVG justification stretches the gaps
// between letters as well as words, which reads badly.)
function para(text, { x, y, w, size, lh, em, cls, widths = [], xs = [] }) {
  const lines = wrap(text, size, w, em, widths);
  const svg = lines.map((l, i) => line(l, { x: xs[i] ?? x, y: y + i * lh, w: widths[i] ?? w, size, em, cls }));
  return { svg: svg.join('\n  '), height: lines.length * lh, lines: lines.length };
}

const hairline = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${INK}" opacity=".3"/>`;
const heading = (text, x, y, w) => `${hairline(x, y, w)}\n  <text x="${x}" y="${y + 24}" class="section">${esc(text)}</text>`;

function render(s, L) {
  const { W, M } = L;
  const IN = W - 2 * M;
  const stacked = !L.side;
  const mainW = stacked ? IN : IN - L.side - L.gutter;
  const sideX = stacked ? M : M + mainW + L.gutter;
  const sideW = stacked ? IN : L.side;
  const out = [];

  // Masthead
  let y = M + L.mast * 0.78;
  out.push(line('The Daily Royston', { x: W / 2, y, w: IN, size: L.mast, em: 0.56, cls: 'mast', anchor: 'middle' }));
  y += 26;
  out.push(`<text x="${W / 2}" y="${y}" class="motto" text-anchor="middle">“All the code that’s fit to ship.”</text>`);

  // Edition line between a thin rule and a double rule
  y += 18;
  out.push(`<rect x="${M}" y="${y}" width="${IN}" height="1" fill="${INK}"/>`);
  y += 20;
  if (stacked) {
    out.push(`<text x="${W / 2}" y="${y}" class="edition" text-anchor="middle">${esc(s.dateShort)}  ·  ${esc(s.volume)}</text>`);
  } else {
    out.push(`<text x="${M}" y="${y}" class="edition">${esc(s.volume)}</text>`);
    out.push(`<text x="${W / 2}" y="${y}" class="edition" text-anchor="middle">${esc(s.dateLong)}</text>`);
    out.push(`<text x="${W - M - 14}" y="${y}" class="edition" text-anchor="end">LATE EDITION</text><circle class="live" cx="${W - M - 4}" cy="${y - 4}" r="3.5" fill="${RED}"/>`);
  }
  y += 10;
  out.push(`<rect x="${M}" y="${y}" width="${IN}" height="3" fill="${INK}"/><rect x="${M}" y="${y + 5}" width="${IN}" height="1" fill="${INK}"/>`);

  // Headline and deck
  y += 22 + L.head;
  const head = wrap(s.headline, L.head, IN, 0.66).slice(0, stacked ? 4 : 2);
  head.forEach((h, i) => out.push(line(h, { x: M, y: y + i * L.headLh, w: IN, size: L.head, em: 0.66, cls: 'head' })));
  y += (head.length - 1) * L.headLh + L.deckLh + 8;
  const deck = para(s.deck, { x: M, y, w: IN, size: L.deck, lh: L.deckLh, em: 0.46, cls: 'deck' });
  out.push(deck.svg);
  y += deck.height + 8;

  // Lead story
  out.push(hairline(M, y, IN));
  const colTop = y;
  y += 30;
  out.push(`<text x="${M}" y="${y}" class="byline">By our GitHub correspondent  ·  ${esc(s.filed)}</text>`);
  y += L.bodyLh + 8;
  const em = 0.5;
  // Drop cap spans three lines: from the first line's cap height to the
  // third line's baseline (Georgia caps are ~0.7em tall).
  const capSize = Math.round((2 * L.bodyLh + 0.7 * L.body) / 0.7);
  const capW = Math.round(capSize * 0.86);
  s.paragraphs.forEach((p, i) => {
    if (i === 0) {
      const widths = [mainW - capW, mainW - capW, mainW - capW];
      out.push(`<text x="${M - 2}" y="${y + 2 * L.bodyLh}" class="dropcap" style="font-size:${capSize}px">${esc(p[0])}</text>`);
      const r = para(p.slice(1), { x: M, y, w: mainW, size: L.body, lh: L.bodyLh, em, cls: 'body', widths, xs: widths.map(() => M + capW) });
      out.push(r.svg);
      y += Math.max(r.lines, 3) * L.bodyLh;
    } else {
      y += 6;
      const r = para(p, { x: M, y, w: mainW, size: L.body, lh: L.bodyLh, em, cls: 'body' });
      out.push(r.svg);
      y += r.height;
    }
  });
  const mainBottom = y;

  // Sidebar: markets, forecast, classifieds
  let sy = stacked ? y + 4 : colTop;
  out.push(heading('Markets', sideX, sy, sideW));
  sy += 26;
  out.push(`<text x="${sideX + sideW}" y="${sy - 2}" class="note" text-anchor="end">share · vs last wk</text>`);
  sy += 26;
  if (s.markets.length) {
    for (const m of s.markets) {
      const up = m.change >= 0;
      out.push(`<text x="${sideX}" y="${sy}" class="row">${esc(m.lang)}</text>
  <text x="${sideX + sideW - 66}" y="${sy}" class="row num" text-anchor="end">${Math.round(m.share)}%</text>
  <text x="${sideX + sideW}" y="${sy}" class="row num" text-anchor="end" fill="${up ? GREEN : RED}">${up ? '▲' : '▼'} ${Math.abs(m.change).toFixed(0)}</text>`);
      sy += 26;
    }
  } else {
    out.push(`<text x="${sideX}" y="${sy}" class="note">Markets closed. No trading this week.</text>`);
    sy += 26;
  }

  for (const [title, text] of [['Forecast', s.forecast], ['Classifieds', s.classified]]) {
    sy += 6;
    out.push(heading(title, sideX, sy, sideW));
    sy += 26 + 24;
    const r = para(text, { x: sideX, y: sy, w: sideW, size: 14, lh: 21, em: 0.5, cls: 'side' });
    out.push(r.svg);
    sy += r.height;
  }

  // Workshop
  y = Math.max(mainBottom, sy) + 14;
  out.push(heading('On the workbench', M, y, IN));
  y += 26 + 30;
  const cols = stacked ? 1 : 3;
  const gap = 26;
  const cw = (IN - gap * (cols - 1)) / cols;
  let rowBottom = y;
  s.workshop.forEach((r, i) => {
    const x = M + (i % cols) * (cw + gap);
    let wy = stacked ? rowBottom : y;
    if (stacked && i) wy += 40;
    out.push(line(r.name, { x, y: wy, w: cw, size: 18, em: 0.55, cls: 'repo' }));
    out.push(`<circle cx="${x + 4}" cy="${wy + 18}" r="4" fill="${LANG_COLORS[r.language] ?? MUTED}"/>`);
    out.push(line(r.meta, { x: x + 14, y: wy + 23, w: cw - 14, size: 13, em: 0.5, cls: 'meta' }));
    const d = para(r.description, { x, y: wy + 46, w: cw, size: 14, lh: 21, em: 0.5, cls: 'side' });
    const lines = d.svg.split('\n  ').slice(0, 3).join('\n  ');
    out.push(lines);
    rowBottom = Math.max(rowBottom, wy + 46 + Math.min(d.lines, 3) * 21 - 14);
  });
  y = rowBottom + 26;

  // Ticker: the sequence repeats until it is wider than the page, and two
  // copies sit a fixed distance apart, so the loop is seamless whatever
  // width the viewer's monospace font has.
  let tick = '';
  while (tick.length * 13 * 0.62 < W + 100) tick += s.ticker.join('    ◆    ') + '    ◆    ';
  const span = Math.ceil(tick.length * 13 * 0.62);
  out.push(`<rect x="0" y="${y}" width="${W}" height="34" fill="${INK}"/>
  <svg x="0" y="${y}" width="${W}" height="34"><g class="ticker" style="animation-duration:${(span / 40).toFixed(0)}s">
    <text x="0" y="22" class="tick" xml:space="preserve">${esc(tick)}</text>
    <text x="${span}" y="22" class="tick" xml:space="preserve">${esc(tick)}</text>
  </g></svg>`);
  const H = y + 34;

  const PAD = 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${PAD} -${PAD} ${W + 2 * PAD} ${H + 2 * PAD}" width="${W + 2 * PAD}" height="${H + 2 * PAD}" role="img" aria-label="The Daily Royston — ${esc(s.headline)}">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 .04"/></feComponentTransfer>
    </filter>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity=".3"/></filter>
  </defs>
  <style>
    text { fill: ${INK}; }
    .mast { font: 700 ${L.mast}px ${SERIF}; letter-spacing: -1px; }
    .motto { font: italic 400 15px ${SERIF}; fill: ${MUTED}; }
    .edition { font: 700 12px ${SERIF}; letter-spacing: 1.2px; }
    .head { font: 700 ${L.head}px ${SERIF}; letter-spacing: -.3px; }
    .deck { font: italic 400 ${L.deck}px ${SERIF}; fill: #34312b; }
    .byline { font: italic 400 14px ${SERIF}; fill: ${MUTED}; }
    .body { font: 400 ${L.body}px ${SERIF}; }
    .dropcap { font-weight: 700; font-family: ${SERIF}; }
    .section { font: 700 16px ${SERIF}; }
    .note { font: italic 400 13px ${SERIF}; fill: ${MUTED}; }
    .row { font: 400 15px ${SERIF}; }
    .num { font-weight: 700; font-variant-numeric: tabular-nums; }
    .side { font: 400 14px ${SERIF}; fill: #2b2924; }
    .repo { font: 700 18px ${SERIF}; }
    .meta { font: 400 13px ${SERIF}; fill: ${MUTED}; }
    .tick { font: 700 13px ${MONO}; fill: ${PAPER}; letter-spacing: .4px; }
    .ticker { animation: tick linear infinite; }
    @keyframes tick { to { transform: translateX(-${span}px); } }
    .live { animation: live 1.6s ease-in-out infinite; }
    @keyframes live { 50% { opacity: .15; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <rect width="${W}" height="${H}" fill="${PAPER}" filter="url(#shadow)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  ${out.join('\n  ')}
</svg>
`;
}

// ------------------------------------------------------------------ main

const story = buildStory(await fetchData());
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/front-page.svg`, render(story, LAYOUTS.desktop));
await writeFile(`${OUT_DIR}/front-page-mobile.svg`, render(story, LAYOUTS.mobile));
console.log(`Printed ${OUT_DIR}/front-page{,-mobile}.svg: ${story.headline}`);
