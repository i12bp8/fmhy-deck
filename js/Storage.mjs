import { resource, isIndexToken, plainText, INDEX_LIMITS } from './Resources.mjs';

export function parseUserState(text) {
  if (!text) return { schema: 1, saved: {}, seen: '' };
  if (text.length > 4 * 1024 * 1024) throw new Error('State exceeds size limit');
  const input = JSON.parse(text);
  if (!input || input.schema !== 1 || !Array.isArray(input.saved) || input.saved.length > 1000) throw new Error('Invalid saved state');
  const saved = {};
  for (const entry of input.saved) {
    const clean = resource(entry);
    if (!clean) throw new Error('Invalid saved resource');
    saved[clean.id] = clean;
  }
  return { schema: 1, saved, seen: typeof input.seen === 'string' ? input.seen.slice(0, 100) : '' };
}

// Tokens are the builder's own isIndexToken output; anything else fails
// closed to a rebuild rather than propagating edited cache data into queries.
export function parseIndex(input, total) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.order) || !Array.isArray(input.starredOrder)
      || input.order.length !== total || input.starredOrder.length > total
      || !input.words || Array.isArray(input.words) || typeof input.words !== 'object') return null;
  const words = Object.create(null);
  let wordCount = 0;
  let postingCount = 0;
  for (const token in input.words) {
    const cells = input.words[token];
    if (++wordCount > INDEX_LIMITS.words || !isIndexToken(token)
        || !Array.isArray(cells) || !cells.length || cells.length % 2 || cells.length > 240000) return null;
    postingCount += cells.length / 2;
    if (postingCount > INDEX_LIMITS.postings) return null;
    const flat = new Array(cells.length);
    for (let c = 0; c < cells.length; c += 2) {
      const index = cells[c];
      const weight = cells[c + 1];
      if (!Number.isInteger(index) || index < 0 || index >= total) return null;
      if (weight !== 90 && weight !== 45 && weight !== 25 && weight !== 10) return null;
      flat[c] = index;
      flat[c + 1] = weight;
    }
    words[token] = flat;
  }
  if (!Object.keys(words).length) return null;
  const inRange = value => Number.isInteger(value) && value >= 0 && value < total;
  if (!input.order.every(inRange) || !input.starredOrder.every(inRange)
      || new Set(input.order).size !== total
      || new Set(input.starredOrder).size !== input.starredOrder.length) return null;
  const categories = parseCategories(input.categories, input.categoryIndex, total);
  if (!categories) return null;
  return { words, order: input.order.slice(), starredOrder: input.starredOrder.slice(),
    categories: categories.tree, categoryIndex: categories.index };
}

// Category text is plain display/lookup data (never executed), so validation
// only has to keep it bounded and free of control characters. Out-of-range
// entry indices fall back to a full rebuild.
function isCategoryText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && plainText(value, max) === value;
}

function parseCategories(treeValue, indexValue, total) {
  if (!Array.isArray(treeValue) || treeValue.length > INDEX_LIMITS.categoryRoots || !indexValue
      || Array.isArray(indexValue) || typeof indexValue !== 'object') return null;
  const tree = [];
  const inRange = value => Number.isInteger(value) && value >= 0 && value < total;
  for (const node of treeValue) {
    if (!node || !isCategoryText(node.name, 100) || !Number.isInteger(node.count) || node.count < 0
        || !Array.isArray(node.children) || node.children.length > 1500) return null;
    const children = [];
    for (const sub of node.children) {
      if (!sub || !isCategoryText(sub.path, 300) || !Number.isInteger(sub.count) || sub.count < 0) return null;
      children.push({ path: sub.path, count: sub.count });
    }
    tree.push({ name: node.name, count: node.count, children });
  }
  const index = Object.create(null);
  let paths = 0;
  for (const path in indexValue) {
    if (!isCategoryText(path, 300) || ++paths > INDEX_LIMITS.categoryPaths || !Array.isArray(indexValue[path])
        || indexValue[path].length > total || !indexValue[path].every(inRange)
        || new Set(indexValue[path]).size !== indexValue[path].length) return null;
    index[path] = indexValue[path].slice();
  }
  for (const node of tree) {
    if (!index[node.name] || index[node.name].length !== node.count) return null;
    for (const child of node.children) {
      if (!index[child.path] || index[child.path].length !== child.count) return null;
    }
  }
  return { tree, index };
}

export function parseCache(text) {
  if (!text || text.length > 32 * 1024 * 1024) throw new Error('Invalid cache size');
  const input = JSON.parse(text);
  if (!input || input.schema !== 1 || !/^[a-f0-9]{40}:[a-f0-9]{40}$/.test(input.revision)
      || !Number.isFinite(input.synced) || input.synced <= 0 || !Array.isArray(input.resources)
      || input.resources.length < 100 || input.resources.length > 60000
      || !input.rules || Array.isArray(input.rules) || typeof input.rules !== 'object'
      || !Array.isArray(input.changes) || input.changes.length > 300) throw new Error('Invalid cache schema');
  // Rebuild resources and warning rules from primitives; never trust cached
  // precomputed hostnames, search fields, actionable flags or prototypes.
  const resources = input.resources.map(resource);
  const ids = Object.create(null);
  for (const entry of resources) {
    if (!entry || ids[entry.id]) throw new Error('Invalid cached catalog');
    ids[entry.id] = true;
  }
  const rules = Object.create(null);
  const domains = Object.keys(input.rules);
  if (!domains.length || domains.length > 10000) throw new Error('Invalid cached warnings');
  for (const domain of domains) {
    const parsed = resource({ title: 'rule', url: 'https://' + domain + '/' });
    const rule = input.rules[domain];
    if (!parsed || parsed.hostname !== domain || !rule || !['warning', 'caution'].includes(rule.level)
        || typeof rule.reason !== 'string' || !rule.reason
        || plainText(rule.reason, 800) !== rule.reason) throw new Error('Invalid cached warning');
    rules[domain] = { level: rule.level, reason: rule.reason };
  }
  const kinds = ['Saved resource warning', 'Saved resource removed', 'Destination changed', 'Preferred status changed', 'New preferred resource'];
  const changes = input.changes.map(change => {
    const entry = resource(change.resource);
    if (!entry || !kinds.includes(change.kind) || typeof change.detail !== 'string'
        || plainText(change.detail, 1500) !== change.detail) throw new Error('Invalid cached change');
    return { kind: change.kind, resource: entry, detail: change.detail };
  });
  return { schema: 1, revision: input.revision, synced: input.synced, resources, rules, changes,
    index: parseIndex(input.index, resources.length) };
}
