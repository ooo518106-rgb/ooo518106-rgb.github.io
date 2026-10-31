// يولّد ahsebha/js/icons-data.js من أيقونات Lucide (ISC) وشعارات Simple Icons (CC0).
// الاستعمال: نزّل الحزمتين من npm وفكّهما (مثلاً npm pack lucide-static@1.64.0 و simple-icons@16.36.0)،
// ثم: LUCIDE_DIR=<مجلد lucide-static> SIMPLE_DIR=<مجلد simple-icons> node tools/build-icons-data.cjs
// لإضافة أيقونة: أضفها إلى EMOJI (يُستبدل الإيموجي تلقائياً بها) أو إلى EXTRA (تُستدعى بالاسم من الشيفرة) ثم أعد التوليد.
const fs = require('fs');
const path = require('path');
const LUCIDE = process.env.LUCIDE_DIR || './lucide/package';
const SIMPLE = process.env.SIMPLE_DIR || './simple/package';
const nodes = require(path.resolve(LUCIDE, 'icon-nodes.json'));
const simple = (n) => fs.readFileSync(path.join(SIMPLE, 'icons', `${n}.svg`), 'utf8').match(/<path d="([^"]+)"/)[1];

// emoji → اسم أيقونة Lucide
const EMOJI = {
  '➕': 'plus', '🔒': 'lock', '🧾': 'receipt-text', '⬇️': 'download', '✅': 'circle-check', '🔎': 'search', '🔍': 'search', '📒': 'notebook-tabs',
  '✏️': 'pencil', '💾': 'save', '🗑️': 'trash', '🗑': 'trash', '🖨️': 'printer', '📥': 'arrow-down-to-line', '📤': 'arrow-up-from-line',
  '📋': 'clipboard-list', '🧪': 'flask-conical', '💬': 'message-circle', '🌙': 'moon', '☀️': 'sun', '📷': 'camera', '⚠️': 'triangle-alert',
  '♻️': 'repeat', '🔑': 'key-round', '💸': 'banknote', '💵': 'banknote', '💰': 'coins', '📦': 'package', '🏦': 'landmark', '🏛️': 'landmark',
  '🛒': 'shopping-cart', '🛍️': 'shopping-bag', '🗂️': 'folder-tree', '👋': 'hand', '👤': 'user', '👥': 'users', '🖥️': 'monitor', '💻': 'laptop',
  '⚖️': 'scale', '💳': 'credit-card', '📝': 'file-pen', '🗣️': 'audio-lines', '↩️': 'undo-2', '↪️': 'redo-2', '💼': 'briefcase', '🏢': 'building',
  '📎': 'paperclip', '📄': 'file-text', '⏳': 'hourglass', '🚚': 'truck', '👷': 'hard-hat', '📊': 'chart-column', '📂': 'folder-open',
  '🔊': 'volume-2', '🏭': 'factory', '🔁': 'arrow-left-right', '🏷️': 'tag', '🕘': 'clock', '🏬': 'store', '📖': 'book-open', '⏸': 'pause',
  'ℹ️': 'info', '📞': 'phone', '⚙️': 'settings', '🔓': 'lock-open', '📱': 'smartphone', '🚧': 'construction', '🏆': 'trophy', '📈': 'trending-up',
  '🎫': 'ticket', '🔗': 'link', '⬆️': 'upload', '🔀': 'shuffle', '🚀': 'rocket', '⏹️': 'square', '⚡': 'zap', '🧮': 'calculator', '✨': 'sparkles',
  '🆕': 'sparkles', '📅': 'calendar', '🏠': 'house', '🧭': 'compass', '🤝': 'handshake', '🧰': 'wrench', '👁️': 'eye', '❌': 'circle-x',
  '➖': 'minus', '🌍': 'globe', '🎉': 'party-popper', '📍': 'map-pin', '⬜': 'square', '⏰': 'alarm-clock', '▶️': 'play', '🖼️': 'image',
  '🔳': 'qr-code', '🛡️': 'shield-check', '👑': 'crown', '⏱️': 'timer', '📴': 'wifi-off', '☰': 'menu',
  '🍎': 'apple', '🪟': 'windows', '🐧': 'linux',
};
// أيقونات تُستدعى مباشرة من الشيفرة (القائمة السفلية، البحث، الأسهم…)
const EXTRA = ['x', 'chevron-down', 'chevron-left', 'chevron-right', 'chevrons-up-down', 'check', 'ellipsis', 'command', 'layout-dashboard', 'list', 'bell',
  'arrow-left', 'arrow-right', 'arrow-up-right', 'copy', 'external-link', 'circle-alert', 'badge-check', 'shield-check', 'wallet', 'users-round', 'file-plus',
  'receipt', 'search', 'plus', 'menu', 'house', 'users', 'package', 'chart-column', 'banknote', 'settings', 'clipboard-list', 'trending-up', 'trending-down',
  'circle', 'panel-right', 'moon', 'sun', 'lock', 'log-out', 'sliders-horizontal'];
const FILLED = { apple: simple('apple'), linux: simple('linux'), windows: 'M3 5.5l8-1.1v7.1H3zM12 4.3L21 3v8.5h-9zM3 12.5h8v7.1l-8-1.1zM12 12.5h9V21l-9-1.3z' };

const names = [...new Set([...Object.values(EMOJI), ...EXTRA])].filter((n) => !FILLED[n]).sort();
const bad = names.filter((n) => !nodes[n]);
if (bad.length) { console.error('أيقونات غير موجودة:', bad); process.exit(1); }
const mk = ([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
const icons = {};
for (const n of names) icons[n] = nodes[n].map(mk).join('');
const filled = {};
for (const [n, d] of Object.entries(FILLED)) filled[n] = `<path d="${d}"/>`;

const out = `// ═══ الأيقونات: مجموعة موحّدة بخطوط رفيعة بدل الإيموجي، تُرسم على الجهاز بلا أي طلب خارجي ═══
// أيقونات الخطوط من مشروع Lucide (ترخيص ISC)، وشعارات أبل ولينكس من Simple Icons (ترخيص CC0)، وشعار ويندوز شكل هندسي بسيط.
//
// ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
// All other copyright (c) for Lucide are held by Lucide Contributors 2022.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted,
// provided that the above copyright notice and this permission notice appear in all copies.
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
// CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
// NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
//
// الاستعمال: icon('house') يرجّع وسم SVG جاهزاً للقوالب. وكل إيموجي مذكور في EMOJI يُستبدل تلقائياً بأيقونته أينما ظهر في الصفحة
// (القوائم والأزرار والرسائل)، فتبقى الشاشات القديمة كما كُتبت وتظهر بالشكل الجديد.

export const ICONS = ${JSON.stringify(icons, null, 1).replace(/\n\s*/g, ' ').replace(/", "/g, '",\n  "').replace(/^\{ /, '{\n  ').replace(/ \}$/, '\n}')};

// أيقونات مصمتة (شعارات الأنظمة)
export const FILLED = ${JSON.stringify(filled, null, 1).replace(/\n\s*/g, ' ').replace(/", "/g, '",\n  "').replace(/^\{ /, '{\n  ').replace(/ \}$/, '\n}')};

// الإيموجي ← اسم الأيقونة
export const EMOJI = ${JSON.stringify(EMOJI, null, 1).replace(/\n\s*/g, ' ').replace(/", "/g, '",\n  "').replace(/^\{ /, '{\n  ').replace(/ \}$/, '\n}')};
`;
fs.writeFileSync(path.join(__dirname, '../ahsebha/js/icons-data.js'), out);
console.log('icons:', names.length, 'filled:', Object.keys(filled).length, 'emoji:', Object.keys(EMOJI).length, 'bytes:', out.length);
