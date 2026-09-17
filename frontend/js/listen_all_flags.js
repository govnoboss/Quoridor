const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const dir = 'C:/Users/Student/Documents/GitHub/Quoridor/frontend/img/emoji';
fs.mkdirSync(dir, { recursive: true });

const codes = execSync('node -e "console.log(require(\'geoip-lite\').codes.join(\',\'))"', { encoding: 'utf8' }).trim().split(',');
console.log('total countries: ' + codes.length);

function flagFile(code) {
    const a = (0x1f1e6 + (code.charCodeAt(0) - 65)).toString(16);
    const b = (0x1f1e6 + (code.charCodeAt(1) - 65)).toString(16);
    return a + '-' + b + '.svg';
}

let ok = 0, fail = 0;
const tmp = path.join(os.tmpdir(), 'quor_flag.tmp.svg');
for (const c of codes) {
    if (!/^[A-Z]{2}$/.test(c)) continue;
    const out = path.join(dir, flagFile(c));
    if (fs.existsSync(out) && fs.statSync(out).size > 0) { ok++; continue; }
    const url = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/' + flagFile(c);
    const code = execSync('curl.exe -s -o ' + JSON.stringify(tmp) + ' -w "%{http_code}" ' + JSON.stringify(url), { encoding: 'utf8' }).trim();
    if (code === '200' && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
        fs.copyFileSync(tmp, out);
        ok++;
    } else {
        console.log('MISS ' + c + ' -> ' + (code));
        fail++;
    }
}
fs.rmSync(tmp, { force: true });
console.log('downloaded: ' + ok + ', missing: ' + fail);
const svgs = fs.readdirSync(dir).filter(x => x.endsWith('.svg'));
console.log('files on disk: ' + svgs.length + ', total: ' + fs.readdirSync(dir).length);