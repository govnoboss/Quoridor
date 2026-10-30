// Приёмка ТЗ 2a — масштабирование главной под любой экран.
// Запуск: node tests/acceptance-home-scaling.js  (нужен запущенный localhost:3000)
// Для каждого размера из ТЗ: viewport W×H, DPR 1 и 2; замеры .home, полей,
// перекрытия подвала, горизонтального скролла; скриншот в tests/screenshots/.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'screenshots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Формула ТЗ 2a для самопроверки браузерных замеров.
function expectedS(w, h) {
  if (w < 1320) return 1;
  return Math.max(0.7, Math.min(2.0, Math.min(w / 1440, (h - 112) / 664)));
}

// Контрольные координаты этапа 2 для 1440×900 (ТЗ 2a): расхождение ≤ 1 px.
const CONTROL_1440 = { leftColX: [65, 405], indicator: [453, 469], board: [479, 1007], rightCol: [1055, 1375] };

const SIZES = [
  [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900],
  [1920, 1080], [1920, 1200], [2560, 1440], [3440, 1440], [820, 1180], [390, 844],
];
const DPRS = [1, 2];

async function measure(page) {
  return page.evaluate(() => {
    const home = document.querySelector('.home');
    const cols = [...document.querySelectorAll('.home-left,.home-center,.home-right')]
      .filter(c => c.getBoundingClientRect().height > 0)
      .map(c => {
        const b = c.getBoundingClientRect();
        return { cls: c.className, left: b.left, right: b.right, top: b.top, bottom: b.bottom, h: b.height };
      });
    const minL = Math.min(...cols.map(c => c.left));
    const maxR = Math.max(...cols.map(c => c.right));
    const maxH = Math.max(...cols.map(c => c.h));
    const tall = cols.find(c => c.h === maxH);
    const header = document.getElementById('mainHeader');
    const footer = document.querySelector('.social-bar');
    if (!home || !header || !footer) {
      return { missing: { home: !!home, header: !!header, footer: !!footer }, url: location.href, screens: [...document.querySelectorAll('.screen')].map(s => s.id + (s.classList.contains('active') ? ':active' : '')) };
    }
    const hB = header.getBoundingClientRect();
    const fB = footer.getBoundingClientRect();
    const de = document.documentElement;
    // Прокрутка на узких экранах идёт внутри #mainMenu, не у документа.
    const mm = document.getElementById('mainMenu');
    const scrollable = de.scrollHeight > de.clientHeight + 1 || mm.scrollHeight > mm.clientHeight + 1;
    const va = tall.top - hB.bottom;
    const vb = fB.top - (tall.top + tall.h);
    const maxBottom = Math.max(...cols.map(c => c.bottom));
    const footerOverlapWithoutScroll = !scrollable && maxBottom > fB.top + 1;
    return {
      s: de.style.getPropertyValue('--s').trim(),
      zoom: getComputedStyle(home).zoom,
      compW: Math.round(maxR - minL),
      marginLeft: Math.round(minL),
      marginRight: Math.round(window.innerWidth - maxR),
      marginPct: Math.round(((window.innerWidth - (maxR - minL)) / 2 / window.innerWidth) * 1000) / 10,
      gapAbove: Math.round(va),
      gapBelow: Math.round(vb),
      gapDiff: Math.abs(Math.round(va - vb)),
      hScroll: de.scrollWidth > de.clientWidth + 1,
      footerOverlapWithoutScroll,
      scrollH: mm.scrollHeight, viewH: mm.clientHeight,
      canvasBacking: document.getElementById('demoBoard').width,
      ws: { l: Math.round((cols[0] || {}).left || 0), r: Math.round((cols[0] || {}).right || 0) },
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: new (require('puppeteer-core').LaunchOptions || (function () {})) ? true : true, args: ['--no-first-run'] });
  const failures = [];
  const report = [];

  for (const dpr of DPRS) {
    for (const [w, h] of SIZES) {
      const filter = process.env.ACCEPT_SIZES;
      if (filter && !filter.includes(`${w}x${h}`)) continue;
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
      await page.goto(BASE, { waitUntil: 'networkidle2' });
      // Ждём активацию меню; изредка при быстрой серии навигаций сервер приклада
      // ограничивает частоту — тогда делаем второй заход после паузы.
      const waitMenu = () => page.waitForSelector('#mainMenu.active', { timeout: 15000 });
      try { await waitMenu(); } catch (e) {
        await new Promise(r => setTimeout(r, 6000));
        await page.goto(BASE, { waitUntil: 'networkidle2' });
        await waitMenu().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 500));
      const m = await measure(page);
      const row = { name: `${w}x${h}@${dpr}` };
      if (m.missing) { console.log('MISSING', row.name, JSON.stringify(m.missing)); failures.push(row.name); report.push({ name: row.name, missing: m.missing }); await page.close(); continue; }
      const exp = expectedS(w, h);
      const okExp = m.s === exp.toFixed(3);
      const okMargins = w >= 1320 ? m.marginPct <= 12 : true;   // ≤12% ширины
      const okVert = w >= 1320 ? m.gapDiff <= 2 : true;         // воздух сверху/снизу ±2px
      const okNoScroll = !m.hScroll;
      const name = `${w}x${h}@${dpr}`;
      row.s = m.s; row.expected = exp.toFixed(3); row.okExp = okExp;
      row.compW = m.compW; row.marginLeft = m.marginLeft; row.marginRight = m.marginRight; row.marginPct = m.marginPct; row.okMargins = okMargins;
      row.gapAbove = m.gapAbove; row.gapBelow = m.gapBelow; row.gapDiff = m.gapDiff; row.okVert = okVert;
      row.hScroll = m.hScroll; row.okNoScroll = okNoScroll; row.footerOverlapWithoutScroll = m.footerOverlapWithoutScroll;
      row.canvasBacking = m.canvasBacking;
      // Контроль 1440×900 координат этапа 2 (только DPR 1 — на DPR2 координаты CSS-те же).
      if (w === 1440 && h === 900 && dpr === 1) {
        const cols2 = await page.evaluate(() => {
          const left = document.querySelector('.home-left').getBoundingClientRect();
          const bar = document.querySelector('.home-eval-bar').getBoundingClientRect();
          const board = document.getElementById('demoBoard').getBoundingClientRect();
          const right = document.querySelector('.home-right').getBoundingClientRect();
          return { left: [left.left, left.right], bar: [bar.left, bar.top, bar.bottom], board: [board.left, board.right], right: [right.left, right.right] };
        });
        row.controls1440 = {
          leftColX: [Math.round(cols2.left[0]), Math.round(cols2.left[1])],
          board: [Math.round(cols2.board[0]), Math.round(cols2.board[1])],
          rightCol: [Math.round(cols2.right[0]), Math.round(cols2.right[1])],
        };
        const c = row.controls1440;
        const within = (a, ref) => Math.abs(a[0] - ref[0]) <= 1 && Math.abs(a[1] - ref[1]) <= 1;
        row.controls1440OK =
          within(c.leftColX, CONTROL_1440.leftColX) &&
          within(c.board, CONTROL_1440.board) &&
          within(c.rightCol, CONTROL_1440.rightCol);
      }
      if (!okExp || !okMargins || !okVert || !okNoScroll || m.footerOverlapWithoutScroll) {
        failures.push(row.name);
      }
      report.push(row);
      await page.screenshot({ path: path.join(OUT, `home-${w}x${h}@${dpr}.png`) });
      await page.close();
      await new Promise(r => setTimeout(r, 3000)); // пауза между заходами (global rate-limit 200/мин)
    }
  }

  fs.writeFileSync(path.join(__dirname, 'screenshots', 'report.json'), JSON.stringify({ failures, rows: report }, null, 2));
  console.table(report.map(r => ({
    'окно': r.name, 's': r.s, 'ожид. s': r.expected, 's ok': r.okExp ? 'Y' : err(r),
    'композиция': r.compW, 'поля L/R': `${r.marginLeft}/${r.marginRight}`, '%': r.marginPct,
    'воздух ±': r.gapDiff, 'скроллл': r.hScroll ? 'X' : 'Y',
    '1440 ctrl': r.controls1440OK === undefined ? '-' : (r.controls1440OK ? 'Y' : 'X'),
  })));
  function err(r) { return `X(${r.s})`; }
  console.log(failures.length ? 'FAIL: ' + failures.join(', ') : 'ALL OK');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
