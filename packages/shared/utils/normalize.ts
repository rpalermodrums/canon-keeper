const APOS_VARIANTS = /[‘’‛`´]/g;
const QUOTE_VARIANTS = /[“”„‟]/g;
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export function normalizeAlias(text: string): string {
  const collapsed = text
    .normalize("NFKC")
    .replace(APOS_VARIANTS, "'")
    .replace(QUOTE_VARIANTS, "\"")
    .trim()
    .replace(/\s+/g, " ");

  const stripped = collapsed.replace(EDGE_PUNCT, "").trim();
  return stripped.replace(/\s+/g, " ").toLowerCase();
}
