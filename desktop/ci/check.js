'use strict';
// للبناء الآلي فقط: يقرأ نتيجة اختبار التشغيل (JSON) ويتحقق من شرط عليها، فيفشل البناء إن لم يتحقق.
//   node ci/check.js <ملف النتيجة> "<شرط على r>" "<وصف>"
// مثال: node ci/check.js first.json "r.ok && r.offlineSite.bundle >= 5" "أول تشغيل بدون إنترنت"
const fs = require('fs');

const [file, expr, label] = process.argv.slice(2);
if (!file || !expr) { console.error('الاستعمال: node ci/check.js <ملف> "<شرط>" "<وصف>"'); process.exit(2); }
let r;
try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`تعذّرت قراءة ${file}: ${e.message}`); process.exit(1); }
let ok = false;
try { ok = !!new Function('r', `return (${expr});`)(r); } catch (e) { console.error(`خطأ في الشرط: ${e.message}`); process.exit(1); }
const stats = r && r.offlineSite ? ` | من أين جاء البرنامج: ${JSON.stringify(r.offlineSite)}` : '';
console.log(`${ok ? 'سليم' : 'فشل'}: ${label || expr}${stats}`);
process.exit(ok ? 0 : 1);
