// ═══ ضغط نسخ البيانات التلقائية (gzip عبر CompressionStream، وبديله نص عادي حيث لا يتوفر) ═══
const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function through(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// يحوّل كائن البيانات إلى سجل يُخزَّن: { gz, data, bytes }
export async function pack(obj) {
  const text = JSON.stringify(obj); // يُنفَّذ فوراً: لقطة متسقة لحظة الاستدعاء حتى لو تغيّر الكائن بعدها
  if (!canGzip()) return { gz: false, data: text, bytes: text.length };
  const z = await through(new TextEncoder().encode(text), new CompressionStream('gzip'));
  return { gz: true, data: z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength), bytes: z.byteLength };
}

export async function unpack(rec) {
  if (!rec) return null;
  if (!rec.gz) return JSON.parse(rec.data);
  if (!canGzip()) throw new Error('هذا المتصفح لا يفك ضغط النسخة التلقائية. افتح البرنامج من متصفح أحدث');
  const raw = await through(new Uint8Array(rec.data), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(raw));
}
