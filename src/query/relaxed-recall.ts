import { queryTerms } from "../tokenize";

const ASCII_TERM = /[a-z0-9_]/i;
const CJK_TERM = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ENGLISH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "last",
  "latest",
  "of",
  "on",
  "or",
  "recent",
  "recently",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "week",
  "were",
  "what",
  "when",
  "where",
  "whether",
  "which",
  "who",
  "why",
]);

export function buildRelaxedRecallQueries(query: string): string[] {
  const terms = queryTerms(query);
  if (terms.length < 2) return [];

  const hasCjkTerm = terms.some((term) => CJK_TERM.test(term));
  const asciiTerms = terms.filter((term) => ASCII_TERM.test(term) && !ENGLISH_STOPWORDS.has(term));
  if (asciiTerms.length === 0 || asciiTerms.length === terms.length) {
    return [];
  }

  const baseTerms = hasCjkTerm ? asciiTerms : asciiTerms.slice(0, 5);
  if (baseTerms.length === 0 || baseTerms.length > 5) return [];

  return buildMorphologicalQueries(baseTerms);
}

function buildMorphologicalQueries(terms: string[]): string[] {
  const combinations: string[][] = [[]];
  for (let index = 0; index < terms.length; index += 1) {
    const variants = expandEnglishTerm(terms[index]!, index === terms.length - 1);
    const next: string[][] = [];
    for (const prefix of combinations) {
      for (const variant of variants) {
        next.push([...prefix, variant]);
        if (next.length >= 12) break;
      }
      if (next.length >= 12) break;
    }
    combinations.splice(0, combinations.length, ...next);
  }

  return unique(combinations.map((combination) => combination.join(" ")));
}

function expandEnglishTerm(term: string, includePluralVariant = true): string[] {
  if (!/^[a-z][a-z0-9_-]{2,}$/i.test(term)) return [term];

  const variants = [term];
  const split = term.split(/[-_]+/).filter(Boolean);
  if (split.length > 1) {
    variants.push(split.join(" "));
    const last = split.at(-1);
    if (last) {
      for (const lastVariant of expandEnglishTerm(last, includePluralVariant)) {
        variants.push([...split.slice(0, -1), lastVariant].join(" "));
      }
    }
  }

  if (includePluralVariant) {
    if (term.endsWith("ies") && term.length > 4) {
      variants.push(`${term.slice(0, -3)}y`);
    } else if (term.endsWith("s") && !term.endsWith("ss") && term.length > 3) {
      variants.push(term.slice(0, -1));
    } else {
      variants.push(`${term}s`);
    }
  }

  return unique(variants);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
