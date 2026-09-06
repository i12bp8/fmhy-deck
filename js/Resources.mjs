import { validateExternalUrl } from './UrlSafety.mjs';

export function plainText(value, limit = 1000) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function descriptionText(value) {
  // FMHY descriptions often begin with a separator because the first item in
  // an alternatives list was the primary link we already extracted.
  return plainText(value).replace(/^[,;/|·–—-]+\s*/u, '');
}

export function normalizeSearchText(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\u2000-\u206f]+/g, ' ').trim();
}

export function resource(value) {
  if (!value || typeof value !== 'object') return null;
  const parsed = validateExternalUrl(value.url);
  const title = plainText(value.title, 200);
  if (!parsed || !title) return null;
  const category = plainText(value.category, 300);
  return { id: parsed.url, url: parsed.url, hostname: parsed.hostname, title,
    description: descriptionText(value.description), category,
    source: /^[a-z-]+\.md$/.test(value.source || '') ? value.source : '', starred: value.starred === true };
}

export function indexResource(value) {
  const result = resource(value);
  if (!result) return null;
  return Object.assign({}, result, { titleTokens: " " + normalizeSearchText(result.title) + " ", search: [result.title, result.hostname, result.category, result.description].map(normalizeSearchText) });
}

// Weight of a token found as a whole word in each field, then as a substring.
const WORD_WEIGHT = [90, 45, 25, 10];
const SUBSTRING_WEIGHT = [65, 45, 25, 10];
const MAX_TOKEN = 48;
const MAX_QUERY_TOKENS = 12;
const MAX_PREFIX_WORDS = 120;
export const INDEX_LIMITS = Object.freeze({ words: 150000, postings: 1000000,
  categoryRoots: 500, categoryPaths: 1200 });

// FMHY is already a directory of free resources, so conversational filler
// should not make a useful query fail. These are ignored only when another
// meaningful token remains; searching for a stop word by itself still works.
const STOP_WORDS = new Set([
  'a', 'an', 'best', 'find', 'for', 'free', 'good', 'great', 'me', 'of',
  'please', 'site', 'sites', 'the', 'to', 'tool', 'tools', 'website', 'websites'
]);

// Small, explicit expansions cover intent words that morphology cannot. Keep
// this deliberately narrow: ranking should come from FMHY's own vocabulary,
// not from a sprawling hand-maintained taxonomy.
const TOKEN_ALIASES = Object.freeze({
  soccer: ['football'],
  subtitle: ['caption'],
  subtitles: ['subtitle', 'caption'],
  television: ['tv'],
  watch: ['stream', 'live'],
  watching: ['stream', 'live']
});

// Tokens must be safe to merge into one flat string and to persist as cache
// keys: ASCII letters and digits plus non-ASCII letters/marks (any script).
// Char-code checks keep builder and cache validator identical in every engine;
// Unicode punctuation and control characters are rejected on both sides.
export function isIndexToken(value) {
  if (!value || value.length >= MAX_TOKEN) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x30 && code <= 0x39) continue;
    if (code >= 0x41 && code <= 0x5a) continue;
    if (code >= 0x61 && code <= 0x7a) continue;
    if (code < 0x80) return false;
    if ((code >= 0x2000 && code <= 0x206f) || code === 0xfeff
        || (code >= 0xfff9 && code <= 0xfffb)) return false;
  }
  return true;
}

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Levenshtein distance. Only ever called on a handful of short vocabulary
// neighbors, so the full DP is cheaper than a clever early exit.
function editDistance(a, b) {
  const rows = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) rows[i] = i;
  for (let j = 1; j <= b.length; j++) {
    let prev = rows[0];
    rows[0] = j;
    const bc = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const saved = rows[i];
      rows[i] = Math.min(rows[i] + 1, rows[i - 1] + 1, prev + (a.charCodeAt(i - 1) === bc ? 0 : 1));
      prev = saved;
    }
  }
  return rows[a.length];
}

// A token that has no exact word anywhere is likely a typo. The vocabulary is
// sorted, so walk outward from the insertion point while words still share its
// leading letters: a plain neighbor window misses crowded prefix families
// (point "firfox" lands many entries past "firefox" inside firefox*). The walk
// is bounded, and distance limits only fire on believable typos.
export function correctToken(vocabulary, token) {
  const length = token.length;
  if (length < 4) return '';
  const limit = length >= 6 ? 2 : 1;
  let lo = 0;
  let hi = vocabulary.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (vocabulary[mid] < token) lo = mid + 1;
    else hi = mid - 1;
  }
  let best = '';
  let bestDistance = limit + 1;
  const consider = candidate => {
    const distance = editDistance(candidate, token);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    let k = pass === 0 ? lo - 1 : lo;
    const step = pass === 0 ? -1 : 1;
    let walked = 0;
    while (k >= 0 && k < vocabulary.length && walked < 2000) {
      const candidate = vocabulary[k];
      if (sharedPrefixLength(candidate, token) < 2) break;
      if (Math.abs(candidate.length - length) <= limit) consider(candidate);
      k += step;
      walked++;
    }
  }
  return bestDistance <= limit ? best : '';
}

function sharedPrefixLength(a, b) {
  const end = Math.min(a.length, b.length, 6);
  let i = 0;
  while (i < end && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function lexicalBase(token) {
  if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 5 && token.endsWith('ing')) {
    let base = token.slice(0, -3);
    if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) base = base.slice(0, -1);
    return base;
  }
  if (token.length > 4 && token.endsWith('ers')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('er')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function queryGroups(value) {
  const normalized = normalizeSearchText(String(value || '').slice(0, 200));
  const raw = normalized.split(' ').filter(Boolean).slice(0, MAX_QUERY_TOKENS);
  let tokens = raw;
  if (raw.length > 1) {
    const useful = raw.filter(token => !STOP_WORDS.has(token));
    if (useful.length) tokens = useful;
  }
  // "Ad blocker" is one established concept whose catalog spelling is
  // usually the closed compound "Adblocking". Treating its two words as
  // unrelated prefixes admits poster/block-layout tools with incidental ads.
  if (tokens.length === 2 && tokens.includes('ad')
      && tokens.some(token => lexicalBase(token) === 'block')) {
    return { normalized, groups: [{ token: 'adblocking', variants: ['adblocking', 'adblock'], categoryHint: 'adblocking' }] };
  }
  const groups = tokens.map(token => {
    const variants = [token];
    const base = lexicalBase(token);
    if (base !== token && base.length >= 2) variants.push(base);
    // Some -ies words pluralize an -ie noun (movies, cookies), while others
    // pluralize -y (categories, utilities). Keeping both bounded candidates is
    // more accurate than pretending a tiny stemmer can infer English origin.
    if (token.length > 4 && token.endsWith('ies')) {
      const withoutPluralS = token.slice(0, -1);
      if (!variants.includes(withoutPluralS)) variants.push(withoutPluralS);
    }
    const aliases = TOKEN_ALIASES[token] || [];
    for (const alias of aliases) if (!variants.includes(alias)) variants.push(alias);
    return { token, variants };
  });
  return { normalized, groups };
}

function prefixWords(vocabulary, prefix) {
  if (prefix.length < 2) return [];
  let lo = 0;
  let hi = vocabulary.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vocabulary[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const words = [];
  while (lo < vocabulary.length && words.length < MAX_PREFIX_WORDS) {
    const word = vocabulary[lo++];
    if (!word.startsWith(prefix)) break;
    if (word !== prefix) words.push(word);
  }
  return words;
}

function addPostingGroup(index, group, starredOnly, category, groupScores, groupMarked, groupCandidates) {
  const visitedWords = new Set();
  function addWord(word, factor) {
    if (visitedWords.has(word)) return;
    visitedWords.add(word);
    const cells = index.words[word];
    if (!cells) return;
    for (let c = 0; c < cells.length; c += 2) {
      const i = cells[c];
      const entry = index.entries[i];
      if ((starredOnly && !entry.starred) || (category && !matchesCategory(entry.category, category))) continue;
      const score = cells[c + 1] * factor;
      if (!groupMarked[i]) {
        groupMarked[i] = 1;
        groupCandidates.push(i);
        groupScores[i] = score;
      } else if (score > groupScores[i]) groupScores[i] = score;
    }
  }
  for (let v = 0; v < group.variants.length; v++) {
    const variant = group.variants[v];
    addWord(variant, v === 0 ? 1 : 0.86);
    const prefixes = prefixWords(index.vocabulary, variant);
    const factor = v === 0 ? 0.72 : 0.64;
    for (const word of prefixes) addWord(word, factor);
  }
}

function addSubstringGroup(index, group, starredOnly, category, groupScores, groupMarked, groupCandidates) {
  for (let i = 0; i < index.total; i++) {
    const entry = index.entries[i];
    if ((starredOnly && !entry.starred) || (category && !matchesCategory(entry.category, category))) continue;
    let score = 0;
    for (const variant of group.variants) score = Math.max(score, substringWeight(entry, variant));
    if (!score) continue;
    const weighted = score * 0.7;
    if (!groupMarked[i]) {
      groupMarked[i] = 1;
      groupScores[i] = weighted;
      groupCandidates.push(i);
    } else if (weighted > groupScores[i]) groupScores[i] = weighted;
  }
}

function phraseScore(entry, normalized, groupCount) {
  const title = entry.search[0];
  if (title === normalized) return 20000;
  if (title.startsWith(normalized)) return 3500;
  if (groupCount > 1 && title.includes(normalized)) return 1400;
  if (entry.search[1] === normalized) return 900;
  return 0;
}

function categoryIntentScore(entry, groups) {
  let score = 0;
  for (const group of groups) {
    if (!group.categoryHint) continue;
    if (entry.search[2] === group.categoryHint) score += 520;
    else if (entry.search[2].startsWith(group.categoryHint + ' ')) score += 400;
    else if (entry.search[2].includes(' ' + group.categoryHint)) score += 140;
  }
  if (groups.length < 2) return score;
  const words = entry.search[2].split(' ');
  let hits = 0;
  for (const group of groups) {
    let matched = false;
    for (const variant of group.variants) {
      const base = lexicalBase(variant);
      if (words.some(word => word === variant || word.startsWith(base) || base.startsWith(word))) {
        matched = true;
        break;
      }
    }
    if (matched) hits++;
  }
  return score + (hits >= 2 ? 180 + hits * 45 : 0);
}

function compareEmptyOrder(entries, a, b) {
  const star = (entries[b].starred ? 3 : 0) - (entries[a].starred ? 3 : 0);
  if (star) return star;
  return compare(entries[a].search[0], entries[b].search[0]) || compare(entries[a].id, entries[b].id);
}

export function matchesCategory(category, filter) {
  if (!filter) return true;
  return category === filter || category.startsWith(filter + ' › ');
}

// Category paths are "Top › Sub" (or just "Top"). Build the browse tree plus
// a per-path entry index ordered exactly like the empty-query result order, so
// browsing the directory needs no per-keystroke scan and is deterministic.
// Every entry is indexed under each prefix of its path, so selecting a parent
// category lists its whole subtree, and node counts are subtree totals.
export function buildCategoryView(entries) {
  const tree = [];
  const byName = new Map();
  const index = Object.create(null);
  let pathCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const category = entries[i].category;
    if (!category) continue;
    const parts = category.split(' › ');
    let node = byName.get(parts[0]);
    if (!node) {
      if (byName.size >= INDEX_LIMITS.categoryRoots) throw new Error('Catalog has too many category roots');
      node = { name: parts[0], exact: 0, children: new Map() };
      byName.set(parts[0], node);
      tree.push(node);
    }
    node.exact += parts.length === 1 ? 1 : 0;
    if (parts.length > 1) {
      let sub = node.children.get(category);
      if (!sub) sub = { path: category, count: 0 };
      sub.count++;
      node.children.set(category, sub);
    }
    let prefix = '';
    for (let k = 0; k < parts.length; k++) {
      prefix = prefix ? prefix + ' › ' + parts[k] : parts[k];
      let list = index[prefix];
      if (!list) {
        if (++pathCount > INDEX_LIMITS.categoryPaths) throw new Error('Catalog has too many category paths');
        index[prefix] = list = [];
      }
      list.push(i);
    }
  }
  const nodes = [];
  for (const node of tree) {
    const children = Array.from(node.children.values())
      .sort((a, b) => b.count - a.count || compare(a.path, b.path))
      .map(sub => ({ path: sub.path, count: sub.count }));
    let count = node.exact;
    for (let c = 0; c < children.length; c++) count += children[c].count;
    nodes.push({ name: node.name, count, children });
  }
  nodes.sort((a, b) => b.count - a.count || compare(a.name, b.name));
  const lists = Object.create(null);
  for (const path in index) {
    index[path].sort((a, b) => compareEmptyOrder(entries, a, b));
    lists[path] = index[path];
  }
  return { tree: nodes, index: lists };
}

// Catalog id → entry index via sorted [id, index] pairs. Building a plain
// dict with 15k long-string keys costs seconds in the Quickshell worker
// interpreter; a sorted array costs one string sort and log(n) comparisons
// per lookup.
export function catalogLookup(index, id) {
  let lo = 0;
  let hi = index.sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = compare(id, index.sorted[mid][0]);
    if (cmp === 0) return index.sorted[mid][1];
    if (cmp < 0) hi = mid - 1;
    else lo = mid + 1;
  }
  return -1;
}

// One flat [entryIndex, weight] pair list per token. Queries resolve through
// this index so a keystroke costs the matching candidates, not the whole
// catalog (the Quickshell worker JS engine is slow on large collections).
// Building it costs seconds in that engine, so it is built once and persisted
// with the cache; see persistIndex/attachIndex.
export function buildSearchIndex(entries) {
  const total = entries.length;
  const words = Object.create(null);
  let wordCount = 0;
  let postingCount = 0;
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    const seen = Object.create(null);
    for (let field = 0; field < 4; field++) {
      const weight = WORD_WEIGHT[field];
      for (const token of entry.search[field].split(' ')) {
        if (isIndexToken(token) && seen[token] === undefined) seen[token] = weight;
      }
    }
    for (const token in seen) {
      let cells = words[token];
      if (!cells) {
        if (++wordCount > INDEX_LIMITS.words) throw new Error('Catalog vocabulary exceeds limit');
        words[token] = cells = [];
      }
      if (++postingCount > INDEX_LIMITS.postings) throw new Error('Catalog search index exceeds limit');
      cells.push(i, seen[token]);
    }
  }
  const compareEmpty = (a, b) => {
    const star = (entries[b].starred ? 3 : 0) - (entries[a].starred ? 3 : 0);
    if (star) return star;
    return compare(entries[a].search[0], entries[b].search[0]) || compare(entries[a].id, entries[b].id);
  };
  const order = entries.map((_, i) => i);
  order.sort(compareEmpty);
  const starredOrder = order.filter(i => entries[i].starred);
  const sorted = new Array(total);
  for (let i = 0; i < total; i++) sorted[i] = [entries[i].id, i];
  sorted.sort((a, b) => compare(a[0], b[0]));
  const view = buildCategoryView(entries);
  return { entries, total, sorted, words, order, starredOrder,
    categories: view.tree, categoryIndex: view.index, vocabulary: Object.keys(words).sort() };
}

export function persistIndex(index) {
  return { words: index.words, order: index.order, starredOrder: index.starredOrder,
    categories: index.categories, categoryIndex: index.categoryIndex };
}

export function attachIndex(serialized, entries) {
  const total = entries.length;
  const sorted = new Array(total);
  for (let i = 0; i < total; i++) sorted[i] = [entries[i].id, i];
  sorted.sort((a, b) => compare(a[0], b[0]));
  return { entries, total, sorted, words: serialized.words, order: serialized.order,
    starredOrder: serialized.starredOrder, categories: serialized.categories,
    categoryIndex: serialized.categoryIndex, vocabulary: Object.keys(serialized.words).sort() };
}

export function searchResources(index, query, tab, saved, limit = 200, category = '') {
  const prepared = queryGroups(query);
  const normalized = prepared.normalized;
  const groups = prepared.groups;
  if (tab === 'Saved') return searchSaved(index, groups, normalized, saved, limit, category);
  if (!groups.length) {
    if (category && tab === 'All') {
      const list = index.categoryIndex[category] || [];
      return { total: list.length, rows: list.slice(0, limit).map(i => index.entries[i]) };
    }
    const order = tab === 'Starred' ? index.starredOrder : index.order;
    if (category) {
      const rows = [];
      for (let k = 0; k < order.length; k++) {
        const entry = index.entries[order[k]];
        if (rows.length < limit && matchesCategory(entry.category, category)) rows.push(entry);
      }
      const total = countCategory(index, order, category);
      return { total, rows };
    }
    return { total: order.length, rows: order.slice(0, limit).map(i => index.entries[i]) };
  }
  const starredOnly = tab === 'Starred';
  const marked = new Uint8Array(index.total);
  const scores = new Float64Array(index.total);
  const coverage = new Uint8Array(index.total);
  const candidates = [];
  const corrected = [];
  for (const group of groups) {
    const groupScores = new Float64Array(index.total);
    const groupMarked = new Uint8Array(index.total);
    const groupCandidates = [];
    addPostingGroup(index, group, starredOnly, category, groupScores, groupMarked, groupCandidates);
    if (!groupCandidates.length) {
      const suggestion = correctToken(index.vocabulary, group.token);
      if (suggestion && suggestion !== group.token) {
        const correctedGroup = { token: suggestion, variants: [suggestion] };
        addPostingGroup(index, correctedGroup, starredOnly, category, groupScores, groupMarked, groupCandidates);
        if (groupCandidates.length) corrected.push({ from: group.token, to: suggestion });
      }
    }
    // Tiny fragments are cheap enough to scan and users expect infix matches
    // while typing ("tol" should find both Toll and Untold). Longer terms only
    // take this path when indexed word/prefix matching found nothing.
    if (!groupCandidates.length || group.token.length <= 3)
      addSubstringGroup(index, group, starredOnly, category, groupScores, groupMarked, groupCandidates);
    for (const i of groupCandidates) {
      if (!marked[i]) { marked[i] = 1; candidates.push(i); }
      scores[i] += groupScores[i];
      coverage[i]++;
    }
  }
  const matched = [];
  // After filler removal, intent words stay strict. Very long queries may miss
  // one concept, which is forgiving without turning results into a loose OR.
  const need = groups.length >= 3 ? groups.length - 1 : groups.length;
  for (const i of candidates) {
    if (coverage[i] < need) continue;
    const entry = index.entries[i];
    scores[i] += phraseScore(entry, normalized, groups.length);
    scores[i] += categoryIntentScore(entry, groups);
    if (entry.starred) scores[i] += 8;
    matched.push(i);
  }
  matched.sort((a, b) => scores[b] - scores[a]
    || compare(index.entries[a].search[0], index.entries[b].search[0])
    || compare(index.entries[a].id, index.entries[b].id));
  return { total: matched.length, rows: matched.slice(0, limit).map(i => index.entries[i]), corrected };
}

function countCategory(index, order, category) {
  let total = 0;
  for (let k = 0; k < order.length; k++) {
    if (matchesCategory(index.entries[order[k]].category, category)) total++;
  }
  return total;
}

function searchSaved(index, groups, normalized, saved, limit, category) {
  const pool = [];
  const missing = [];
  for (const id in saved) {
    const i = catalogLookup(index, id);
    if (i >= 0 && matchesCategory(index.entries[i].category, category)) pool.push(index.entries[i]);
    else if (i < 0 && matchesCategory(saved[id].category, category)) missing.push(indexResource(saved[id]));
  }
  const all = pool.concat(missing);
  if (!groups.length) {
    const ordered = all.slice().sort((a, b) => (b.starred ? 3 : 0) - (a.starred ? 3 : 0)
      || compare(a.search[0], b.search[0]) || compare(a.id, b.id));
    return { total: ordered.length, rows: ordered.slice(0, limit) };
  }
  const matches = [];
  const need = groups.length >= 3 ? groups.length - 1 : groups.length;
  for (const entry of all) {
    let score = 0;
    let coverage = 0;
    for (const group of groups) {
      let best = 0;
      for (const variant of group.variants) {
        if (entry.titleTokens.includes(' ' + variant + ' ')) best = Math.max(best, WORD_WEIGHT[0]);
        best = Math.max(best, substringWeight(entry, variant));
        const base = lexicalBase(variant);
        if (base.length >= 2) {
          for (let field = 0; field < 4; field++) {
            if (entry.search[field].split(' ').some(word => word.startsWith(base))) {
              best = Math.max(best, WORD_WEIGHT[field] * 0.7);
              break;
            }
          }
        }
      }
      if (best) { score += best; coverage++; }
    }
    if (coverage < need) continue;
    score += phraseScore(entry, normalized, groups.length) + categoryIntentScore(entry, groups);
    if (entry.starred) score += 8;
    matches.push({ entry, score });
  }
  matches.sort((a, b) => b.score - a.score
    || compare(a.entry.search[0], b.entry.search[0]) || compare(a.entry.id, b.entry.id));
  return { total: matches.length, rows: matches.slice(0, limit).map(match => match.entry) };
}

function substringWeight(entry, token) {
  for (let field = 0; field < 4; field++) {
    if (entry.search[field].includes(token)) return SUBSTRING_WEIGHT[field];
  }
  return 0;
}
