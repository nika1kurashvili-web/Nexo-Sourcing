// Works out which product code a photo file name belongs to.
//   P00012.jpg      -> P00012
//   P00012_2.jpg    -> P00012 (second photo), also "P00012-2", "P00012 2", "P00012 (2)"
// The caller tries the candidates in order, so a code that itself ends in _2 still matches exactly first.
export function skuCandidates(fileName: string): string[] {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
  const out = new Set<string>();
  const add = (value: string) => { const v = value.trim().toLowerCase(); if (v) out.add(v); };
  add(base);
  const withoutParens = base.replace(/\s*\(\d{1,2}\)$/, "");
  add(withoutParens);
  add(withoutParens.replace(/[\s._-]\d{1,2}$/, ""));
  return Array.from(out);
}
