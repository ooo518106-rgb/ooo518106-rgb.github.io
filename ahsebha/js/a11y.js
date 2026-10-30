// ═══ تحسينات الوصول لما يُرسم داخل الصفحة (قارئات الشاشة ولوحة المفاتيح) ═══
// تُطبَّق على منطقة المحتوى كلها دفعة واحدة في كل إطار رسم بعد أي تغيير، فتغطي القوائم والنماذج والنوافذ المرسومة لاحقاً:
// • الجدول القابل للتمرير يُفتح بالتبويب (Tab) والأسهم، ويُعلن كمنطقة باسم فريد.
// • عنوان الصفحة (h2) يُعلن كعنوان رئيسي واحد وتُنزَّل بقية العناوين مستوى (h3 ← 2)، وعناوين الفاتورة المطبوعة (h1 ← 2)،
//   فيستقيم الترتيب لقارئ الشاشة بدون تغيير الوسوم ولا الشكل.
// • حقل بلا اسم يأخذ اسمه من عنوان خليته (data-label) أو من عنوان الحقل المجاور أو من النص الإرشادي؛ والزر الأيقوني من نوع عمله؛
//   وعمود الجدول الفارغ العنوان (الإجراءات) يُسمّى.
// أسماء كتبناها صراحةً في القوالب (aria-label) لا تُستبدل.

const SKIP_INPUT = 'input[type="hidden"], input[type="file"], input[type="submit"], input[type="button"]';
const ICON_BUTTONS = { edit: 'تعديل', del: 'حذف', remove: 'حذف', rename: 'إعادة تسمية', print: 'طباعة', close: 'إغلاق', x: 'إغلاق', up: 'أعلى', down: 'أسفل' };

const labelled = (el) => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || !!el.title || !!(el.labels && el.labels.length);
const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

function nameFields(view) {
  for (const el of view.querySelectorAll(`input:not(${SKIP_INPUT.split(', ').join('):not(')}), select, textarea`)) {
    if (labelled(el)) continue;
    const cell = el.closest('[data-label]');
    const fld = el.closest('.fld');
    const name = (cell && cell.dataset.label) || (fld && fld.querySelector('.fld-l') && textOf(fld.querySelector('.fld-l'))) || el.getAttribute('placeholder') || '';
    if (name) el.setAttribute('aria-label', name);
  }
  for (const b of view.querySelectorAll('button:not([aria-label]):not([title])')) {
    if (textOf(b)) continue;
    for (const k of Object.keys(b.dataset)) {
      if (ICON_BUTTONS[k]) { b.setAttribute('aria-label', ICON_BUTTONS[k]); break; }
    }
  }
  for (const th of view.querySelectorAll('th:empty')) th.innerHTML = '<span class="sr-only">إجراءات</span>';
}

function nameTables(view) {
  const wraps = [...view.querySelectorAll('.tbl-wrap')];
  const names = new Map();
  for (const w of wraps) {
    if (w.dataset.a11y === 'auto' || !w.hasAttribute('aria-label')) {
      const card = w.closest('.card');
      const h = card && card.querySelector('.card-h h3, h3');
      const base = (h && textOf(h)) || 'جدول البيانات';
      names.set(base, (names.get(base) || 0) + 1);
      w.tabIndex = 0;
      w.setAttribute('role', 'region');
      w.setAttribute('aria-label', names.get(base) > 1 ? `${base} ${names.get(base)}` : base);
      w.dataset.a11y = 'auto';
    }
  }
}

function nameHeadings(view) {
  const title = view.querySelector('.page-head h2');
  const level = (h, n) => { if (!h.hasAttribute('aria-level')) h.setAttribute('aria-level', String(n)); };
  if (title) {
    title.setAttribute('role', 'heading');
    title.setAttribute('aria-level', '1');
    for (const h of view.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (h === title) continue;
      const tag = Number(h.tagName[1]);
      level(h, h.closest('.paper') ? (tag === 1 ? 2 : tag) : Math.max(2, tag - 1));
    }
  } else if (!view.querySelector('h1, [role="heading"][aria-level="1"]')) {
    const first = view.querySelector('h2, h3');
    if (first) { first.setAttribute('role', 'heading'); first.setAttribute('aria-level', '1'); }
  }
}

export function enhance(view) {
  if (!view || !view.querySelectorAll) return;
  nameTables(view);
  nameHeadings(view);
  nameFields(view);
}

let observer = null;
export function watchA11y(view = typeof document !== 'undefined' ? document.getElementById('view') : null) {
  if (observer || !view || typeof MutationObserver === 'undefined') return;
  let frame = 0;
  const run = () => { frame = 0; enhance(view); };
  const queue = () => { if (!frame) frame = requestAnimationFrame(run); };
  queue();
  observer = new MutationObserver(queue);
  observer.observe(view, { childList: true, subtree: true });
}
