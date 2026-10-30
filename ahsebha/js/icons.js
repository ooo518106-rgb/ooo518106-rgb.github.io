// ═══ الأيقونات: وسوم SVG جاهزة، واستبدال تلقائي للإيموجي بأيقونات موحّدة أينما ظهر في الصفحة ═══
// البيانات (والتراخيص) في icons-data.js. هنا المنطق فقط، بلا اعتماد على بقية البرنامج.
import { ICONS, FILLED, EMOJI } from './icons-data.js';

const VS16 = /️/g; // محدد شكل الإيموجي: يختلف وجوده بين النصوص فنتجاهله عند المطابقة
const BASE = new Map(Object.entries(EMOJI).map(([e, n]) => [e.replace(VS16, ''), n]));
const source = [...BASE.keys()].sort((a, b) => b.length - a.length).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const FIND = new RegExp(`(?:${source})\\uFE0F?`, 'gu');
const HAS = new RegExp(`(?:${source})`, 'u');

// وسم SVG كنص: للقوالب التي تبني HTML. الاسم الخاطئ يرجّع نصاً فارغاً
export function icon(name, cls = '') {
  const fill = FILLED[name];
  const inner = fill || ICONS[name];
  if (!inner) return '';
  return `<svg class="i${fill ? ' i-fill' : ''}${cls ? ' ' + cls : ''}" data-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}
export const iconNames = () => [...Object.keys(ICONS), ...Object.keys(FILLED)];
export const iconFor = (emoji) => BASE.get(String(emoji).replace(VS16, '')) || '';

// ─── الاستبدال في الصفحة ───
// ما لا يُمسّ: حقول الإدخال (لا تقبل عناصر)، الأوراق المطبوعة، الشيفرة، وما وُسم بـ data-no-icons
const SKIP = 'script,style,textarea,input,select,option,svg,code,pre,title,noscript,.paper,#print-area,[data-no-icons]';
const cache = new Map();
function svgNode(name) {
  if (!cache.has(name)) {
    const t = document.createElement('template');
    t.innerHTML = icon(name);
    cache.set(name, t.content.firstChild);
  }
  return cache.get(name).cloneNode(true);
}

function replaceText(node) {
  const text = node.nodeValue;
  const frag = document.createDocumentFragment();
  let last = 0;
  FIND.lastIndex = 0;
  for (let m = FIND.exec(text); m; m = FIND.exec(text)) {
    const name = BASE.get(m[0].replace(VS16, ''));
    if (!name) continue;
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(svgNode(name));
    last = m.index + m[0].length;
  }
  if (!last) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}

export function iconize(root = document.body) {
  if (!root) return;
  if (root.nodeType === 3) {
    if (root.parentElement && !root.parentElement.closest(SKIP) && HAS.test(root.nodeValue)) replaceText(root);
    return;
  }
  if (root.nodeType !== 1 || root.closest(SKIP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (HAS.test(n.nodeValue) && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const hits = [];
  while (walker.nextNode()) hits.push(walker.currentNode);
  hits.forEach(replaceText);
}

// يبدأ المراقبة: كل ما يُضاف للصفحة (قوائم، نوافذ، رسائل) يُستبدل إيموجيه قبل أن يُرسم
let observer = null;
export function watchIcons() {
  if (observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  iconize(document.body);
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') iconize(m.target);
      else m.addedNodes.forEach((n) => iconize(n));
    }
    observer.takeRecords(); // ما أحدثناه نحن لا نعيد فحصه
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
