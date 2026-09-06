import { indexResource, buildSearchIndex, attachIndex, persistIndex, searchResources, catalogLookup, buildCategoryView } from './Resources.mjs';
import { parseDocument, documents } from './FmhySource.mjs';
import { buildSafetyIndex, safetyFor } from './Safety.mjs';
import { diffResources } from './Diff.mjs';
import { parseCache } from './Storage.mjs';

let active = { resources: [], rules: {}, changes: [], revision: '', synced: 0 };
let indexed = [];
let index = null;
let staging = null;
let pending = null;
let saved = {};
let query = { query: '', tab: 'All', serial: 0, category: '' };
const MAX_CATALOG_TEXT = 8 * 1024 * 1024;

function resourceTextSize(entry) {
  return entry.url.length + entry.title.length + entry.description.length
    + entry.category.length + entry.source.length;
}

function rowShape(entry, missing) {
  return Object.assign({}, entry, { search: undefined,
    safety: safetyFor(entry.url, active.rules), missing });
}

function results() {
  // 'saved' can arrive before 'load' at startup; the index is rebuilt by the
  // activate() that follows, which replays the query with the current saved set.
  if (!index) return;
  const result = searchResources(index, query.query, query.tab, saved, 200, query.category || '');
  const rows = result.rows.map(entry => rowShape(entry, catalogLookup(index, entry.id) < 0));
  WorkerScript.sendMessage({ kind: 'results', serial: query.serial, total: result.total, rows,
    corrected: result.corrected || [] });
}

function activate(snapshot) {
  active = snapshot;
  indexed = active.resources.map(indexResource);
  index = active.index ? attachIndex(active.index, indexed) : buildSearchIndex(indexed);
  // Pre-index caches carry no category view; rebuild it once and persist.
  if (!index.categories) {
    const view = buildCategoryView(indexed);
    index.categories = view.tree;
    index.categoryIndex = view.index;
  }
  WorkerScript.sendMessage({ kind: 'active', revision: active.revision, synced: active.synced,
    count: indexed.length, changes: active.changes, rules: active.rules,
    categories: index.categories });
  results();
}

function withIndex(snapshot) {
  // The index is too expensive to rebuild in this interpreter on every start;
  // persist it with the cache when a fresh snapshot lacks one.
  if (snapshot.index && index.categories) return snapshot;
  pending = Object.assign({}, snapshot, { index: persistIndex(index) });
  WorkerScript.sendMessage({ kind: 'persist', text: JSON.stringify(pending) });
  return snapshot;
}

WorkerScript.onMessage = function(message) {
  try {
    switch (message.kind) {
    case 'load': {
      const snapshot = parseCache(message.text);
      activate(snapshot);
      withIndex(snapshot);
      break;
    }
    case 'query': query = message; results(); break;
    case 'saved': saved = message.saved; results(); break;
    case 'random': {
      if (!index) return;
      // Prefer starred resources so discovery surfaces FMHY's quality picks.
      const starred = index.starredOrder;
      const pool = starred.length && Math.random() < 0.75 ? starred.map(i => index.entries[i]) : index.entries;
      const entry = pool[Math.floor(Math.random() * pool.length)];
      WorkerScript.sendMessage({ kind: 'random', serial: message.serial, entry: rowShape(entry, false) });
      break;
    }
    case 'begin': staging = { resources: new Map(), documents: 0, safety: {}, revision: message.revision, textSize: 0 }; pending = null; break;
    case 'document':
      if (!staging) throw new Error('No update in progress');
      if (message.source.kind === 'catalog') {
        for (const entry of parseDocument(message.text, message.source.name)) {
          const previous = staging.resources.get(entry.id);
          staging.resources.set(entry.id, previous ? Object.assign({}, previous, { starred: previous.starred || entry.starred }) : entry);
          if (!previous) {
            staging.textSize += resourceTextSize(entry);
            if (staging.textSize > MAX_CATALOG_TEXT) throw new Error('Catalog text exceeds limit');
          }
        }
        staging.documents++;
        if (staging.resources.size > 60000) throw new Error('Catalog exceeds resource limit');
      } else staging.safety[message.source.name] = message.text;
      WorkerScript.sendMessage({ kind: 'next' });
      break;
    case 'finish': {
      if (!staging || staging.documents !== documents.length || staging.resources.size < 1000
          || (active.resources.length && staging.resources.size < active.resources.length * 0.7)) throw new Error('Incomplete catalog');
      const resources = Array.from(staging.resources.values());
      const rules = buildSafetyIndex(staging.safety['sitelist.txt'], staging.safety['sitelist-plus.txt'], staging.safety['filterlists-reasons.json']);
      const changes = active.revision ? diffResources(active.resources, resources, saved, active.rules, rules) : [];
      // Retain unseen events across refreshes; deduplicate by semantic content.
      const retained = message.seen === active.revision ? [] : active.changes;
      const combined = changes.concat(retained).filter((entry, entryIndex, all) => all.findIndex(other =>
        other.kind === entry.kind && other.resource.id === entry.resource.id && other.detail === entry.detail) === entryIndex).slice(0, 300);
      pending = { schema: 1, revision: staging.revision, synced: Date.now(), resources, rules, changes: combined,
        index: persistIndex(buildSearchIndex(resources.map(indexResource))) };
      staging = null;
      const text = JSON.stringify(pending);
      if (text.length > 32 * 1024 * 1024) throw new Error('Cache exceeds size limit');
      WorkerScript.sendMessage({ kind: 'persist', text });
      break;
    }
    case 'unchanged':
      pending = Object.assign({}, active, { synced: Date.now(), schema: 1, index: persistIndex(index) });
      WorkerScript.sendMessage({ kind: 'persist', text: JSON.stringify(pending) });
      break;
    case 'commit': if (pending) { activate(pending); pending = null; } break;
    case 'abort': staging = null; pending = null; break;
    }
  } catch (error) {
    staging = null;
    pending = null;
    WorkerScript.sendMessage({ kind: 'error', operation: message.kind, reason: String(error.message).slice(0, 160) });
  }
};
