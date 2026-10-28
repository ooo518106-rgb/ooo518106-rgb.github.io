// اختبارات تثبيت التطبيق على اللابتوب: كشف المتصفح من هويته وشرح الخطوات
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserKind, KINDS } from '../js/views/install.js';
import { DOWNLOADS, REPO, detectOS, downloadUrl, forOS, releasesUrl } from '../js/downloads.js';

const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
};

test('كشف المتصفح: لابتوب ويندوز وماك، والجوال', () => {
  assert.equal(browserKind(UA.winChrome, 0), 'chrome');
  assert.equal(browserKind(UA.macChrome, 0), 'chrome');
  assert.equal(browserKind(UA.opera, 0), 'chrome');
  assert.equal(browserKind(UA.headless, 0), 'chrome');
  assert.equal(browserKind(UA.winEdge, 0), 'edge', 'Edge يحمل كلمة Chrome أيضاً لكنه Edge');
  assert.equal(browserKind(UA.macSafari, 0), 'safari');
  assert.equal(browserKind(UA.winFirefox, 0), 'firefox');
  assert.equal(browserKind(UA.iphone, 5), 'ios');
  assert.equal(browserKind(UA.iphoneChrome, 5), 'ios', 'Chrome على آيفون يتبع طريقة Safari');
  assert.equal(browserKind(UA.macSafari, 5), 'ios', 'iPad الحديث يعرّف نفسه كـ Mac لكن بلمس متعدد');
  assert.equal(browserKind(UA.androidChrome, 5), 'android');
  assert.equal(browserKind(UA.androidEdge, 5), 'android');
  assert.equal(browserKind(UA.samsung, 5), 'android');
  assert.equal(browserKind('curl/8.5.0', 0), 'other');
  assert.equal(browserKind('', 0), 'other');
});

test('شرح الخطوات: لكل متصفح خطوات واضحة، ولللابتوب الأولوية', () => {
  for (const k of ['chrome', 'edge', 'safari', 'firefox', 'ios', 'android', 'other']) {
    assert.ok(KINDS[k].name && KINDS[k].steps.length >= 2, k);
    assert.ok(KINDS[k].steps.every((s) => typeof s === 'string' && s.length > 10), k);
  }
  assert.match(KINDS.chrome.name, /ويندوز أو ماك/);
  assert.match(KINDS.edge.name, /ويندوز أو ماك/);
  assert.match(KINDS.chrome.steps.join(' '), /تثبيت/);
  assert.match(KINDS.safari.steps.join(' '), /Dock/);
  assert.match(KINDS.firefox.steps.join(' '), /Chrome أو Edge/, 'Firefox: يوجّه للمتصفح الذي يدعم التثبيت');
});

test('كشف نظام الجهاز لصفحة التحميل', () => {
  assert.equal(detectOS(UA.winChrome, 0), 'windows');
  assert.equal(detectOS(UA.winEdge, 0), 'windows');
  assert.equal(detectOS(UA.winFirefox, 0), 'windows');
  assert.equal(detectOS(UA.macSafari, 0), 'mac');
  assert.equal(detectOS(UA.macChrome, 0), 'mac');
  assert.equal(detectOS(UA.headless, 0), 'linux');
  assert.equal(detectOS(UA.iphone, 5), 'ios');
  assert.equal(detectOS(UA.macSafari, 5), 'ios', 'iPad الحديث');
  assert.equal(detectOS(UA.androidChrome, 5), 'android');
  assert.equal(detectOS('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36', 0), 'other', 'Chromebook ليس لينكس عادياً');
  assert.equal(detectOS('', 0), 'other');
});

test('روابط التحميل: ثابتة ومن صفحة الإصدارات الرسمية، ومطابقة لأسماء الملفات التي يبنيها البناء', () => {
  assert.equal(downloadUrl('Ahsebha-Setup.exe'), `https://github.com/${REPO}/releases/latest/download/Ahsebha-Setup.exe`);
  assert.equal(releasesUrl, `https://github.com/${REPO}/releases/latest`);
  assert.deepEqual(DOWNLOADS.map((d) => d.file), ['Ahsebha-Setup.exe', 'Ahsebha-mac-arm64.dmg', 'Ahsebha-mac-x64.dmg', 'Ahsebha-linux-x64.AppImage']);
  assert.deepEqual(forOS('mac').map((d) => d.id), ['mac-arm64', 'mac-x64'], 'ماك فيه معالجان');
  assert.deepEqual(forOS('windows').map((d) => d.id), ['win']);
  assert.deepEqual(forOS('ios'), []);
  // أسماء الملفات تُشتق من إعدادات البناء الحقيقية
  const b = JSON.parse(readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8')).build;
  assert.equal(b.nsis.artifactName.replace('${ext}', 'exe'), 'Ahsebha-Setup.exe');
  assert.equal(b.mac.artifactName.replace('${arch}', 'arm64').replace('${ext}', 'dmg'), 'Ahsebha-mac-arm64.dmg');
  assert.equal(b.mac.artifactName.replace('${arch}', 'x64').replace('${ext}', 'dmg'), 'Ahsebha-mac-x64.dmg');
  assert.equal(b.linux.artifactName.replace('${ext}', 'AppImage'), 'Ahsebha-linux-x64.AppImage');
  // المستودع المذكور هو نفسه الذي ينشر فيه سير العمل
  const wf = readFileSync(new URL('../../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  assert.match(wf, /gh release create/);
  assert.ok(wf.includes('installers/*'));
});
