export interface TextRange {
  start: number;
  end: number;
}

interface NormalizedIndexMap {
  normalized: string;
  /** For each UTF-16 code unit in `normalized`, the [start, end) range in the original string. */
  spans: TextRange[];
}

const COMBINING_DIACRITICS_RE = /[\u0300-\u036f]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const ARABIC_HARAKAT_RE = /[\u064B-\u065F\u0670]/g;
const TRAILING_COMBINING_MARK_RE = /^[\u0300-\u036f\u064B-\u065F\u0670]/;

function normalizeSegment(segment: string): string {
  return segment
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_RE, '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(ARABIC_HARAKAT_RE, '')
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .toLowerCase();
}

/**
 * Normalizes a string for accent-, diacritic-, ZWNJ-, and Persian/Arabic-variant-insensitive search.
 * Preserves internal whitespace; trims outer whitespace for query comparison.
 */
export function normalizeForSearch(str: string): string {
  if (!str) return '';
  return normalizeSegment(str).trim();
}

/**
 * Builds a normalized search string alongside an exact map from each normalized UTF-16 index
 * back to its original [start, end) range in `originalText`.
 */
export function buildNormalizedIndexMap(originalText: string): NormalizedIndexMap {
  if (!originalText) {
    return { normalized: '', spans: [] };
  }

  let normalized = '';
  const spans: TextRange[] = [];

  let i = 0;
  while (i < originalText.length) {
    const codePoint = originalText.codePointAt(i);
    const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const rawUnit = originalText.slice(i, i + charLen);
    const normUnit = normalizeSegment(rawUnit);

    if (normUnit.length > 0) {
      for (let j = 0; j < normUnit.length; j++) {
        normalized += normUnit[j];
        spans.push({ start: i, end: i + charLen });
      }
    }

    i += charLen;
  }

  return { normalized, spans };
}

/**
 * Finds all non-overlapping original-string ranges in `originalText` matching `rawQuery`
 * under normalized comparison (accurately handling ZWNJ, Arabic/Persian harakat, NFD accents,
 * leading whitespace, and surrogate pairs).
 */
export function findSearchMatchRanges(originalText: string, rawQuery: string): TextRange[] {
  const normQuery = normalizeForSearch(rawQuery);
  if (!originalText || !normQuery) return [];

  const { normalized, spans } = buildNormalizedIndexMap(originalText);
  if (!normalized || normQuery.length > normalized.length) return [];

  const ranges: TextRange[] = [];
  let searchFrom = 0;

  while (searchFrom <= normalized.length - normQuery.length) {
    const idx = normalized.indexOf(normQuery, searchFrom);
    if (idx === -1) break;

    const lastNormIdx = idx + normQuery.length - 1;
    const origStart = spans[idx].start;
    let origEnd = spans[lastNormIdx].end;

    // Keep any trailing combining marks (diacritics / harakat) attached to the final matched
    // base character inside the highlighted span so ligatures & marks render intact.
    while (origEnd < originalText.length) {
      const rest = originalText.slice(origEnd);
      if (TRAILING_COMBINING_MARK_RE.test(rest)) {
        origEnd += 1;
      } else {
        break;
      }
    }

    ranges.push({ start: origStart, end: origEnd });
    searchFrom = idx + normQuery.length;
  }

  return ranges;
}
