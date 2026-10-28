// ═══ ملخص اليوم: المساعد بيحكيلك شو صار بمتجرك، بالكتابة وبالصوت ═══
// الأرقام من الدفاتر نفسها (نفس التقارير)، والكلام بيتولّد على الجهاز، وما بيطلع منه أي شي.
import * as store from '../store.js';
import { summaryFacts, narrate, speechParts, shareText, PERIODS, dayName } from '../insights.js';
import { html, raw, $, $$, empty } from '../ui.js';
import { setTitle, withQuery } from '../nav.js';
import { head, S, today, waLink } from './common.js';
import { speak, stopSpeaking, speechSupported, voiceHint } from './speech.js';

export function view({ root, query, path }) {
  const db = store.getDb();
  setTitle('ملخص اليوم');
  const preset = PERIODS[query.p] ? query.p : 'today';
  if (!db.docs.length) {
    root.innerHTML = String(html`${head('ملخص اليوم', { sub: 'المساعد بيحكيلك شو صار بمتجرك' })}
      ${empty('🗣️', 'لسّا ما في حركة تتحكى', 'سجّل فواتير ومصاريف، وكل يوم بحكيلك شو صار: كم بعت، كم ربحت، مين لازم تذكّره، وشو قارب يخلص.', html`<a class="btn btn-primary" href="#/sales/new">🧾 فاتورة جديدة</a>`)}`);
    return;
  }
  const f = summaryFacts(db, store.getBooks(), { preset, today: today() });
  const secs = narrate(f, 'text');
  const when = f.range.from === f.range.to ? dayName(f.range.to) : `${dayName(f.range.from)} ← ${dayName(f.range.to)}`;
  const canSpeak = speechSupported();

  const card = (s) => html`<section class="card today-card ${s.id === 'attention' ? 'today-wide' : ''}" data-sec="${s.id}">
    <div class="card-h"><h3><span class="today-ic" aria-hidden="true">${s.icon}</span> ${s.title}</h3>${s.href ? html`<a class="small" href="${s.href}">التفاصيل ←</a>` : ''}</div>
    ${s.id === 'attention' && s.items.length
      ? html`<div class="list-mini">${s.items.map((w) => html`<a href="${w.href}"><span>${w.text}</span><span class="meta">${w.go} ←</span></a>`)}</div>`
      : html`<p class="today-text">${s.text}</p>`}
  </section>`;

  root.innerHTML = String(html`${head('ملخص اليوم', {
    sub: html`${when} · <span class="muted">المساعد بيحكيلك شو صار بمتجرك من أرقام دفاترك</span>`,
    actions: html`${canSpeak ? html`<button class="btn btn-primary" data-speak>🔊 اسمع الملخص</button>` : ''}<button class="btn btn-ghost" data-share>💬 واتساب</button>`,
  })}
    <div class="seg today-tabs" role="tablist">${Object.entries(PERIODS).map(([k, p]) => html`<a role="tab" class="${k === preset ? 'on' : ''}" aria-selected="${String(k === preset)}" href="${withQuery(path, k === 'today' ? {} : { p: k })}">${p.label}</a>`)}</div>
    <p class="note note-warn today-hint" data-hint ${canSpeak ? raw('hidden') : ''}>${canSpeak ? '' : voiceHint('unsupported')}</p>
    <div class="today-grid">${secs.map(card)}</div>
    <p class="muted small today-foot">🔒 الملخص بيتحسب على جهازك من دفاترك، وما بيطلع منه أي شي لأي مكان. أرقامه هي نفسها أرقام التقارير.</p>`);

  const btn = $('[data-speak]', root);
  const hint = $('[data-hint]', root);
  const mark = (id) => $$('.today-card', root).forEach((c) => c.classList.toggle('speaking', c.dataset.sec === id));
  const idle = () => { if (btn) { btn.textContent = '🔊 اسمع الملخص'; btn.classList.remove('speaking'); } mark(null); };
  if (btn) {
    btn.onclick = async () => {
      if (btn.classList.contains('speaking')) { stopSpeaking(); idle(); return; }
      hint.hidden = true;
      btn.classList.add('speaking');
      btn.textContent = '⏹️ أوقف';
      window.addEventListener('hashchange', stopSpeaking, { once: true });
      const r = await speak(speechParts(f), { onPart: (p) => mark(p.id), onEnd: idle });
      if (!r.ok) { idle(); hint.textContent = voiceHint(r.reason); hint.hidden = false; }
    };
  }
  $('[data-share]', root).onclick = () => window.open(waLink('', shareText(f, S().name)), '_blank', 'noopener');
}
