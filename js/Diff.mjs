import { normalizeSearchText } from './Resources.mjs';
import { safetyFor } from './Safety.mjs';

export function diffResources(previous, current, saved, oldRules, newRules) {
  const oldById = new Map(previous.map(entry => [entry.id, entry]));
  const newById = new Map(current.map(entry => [entry.id, entry]));
  const key = entry => normalizeSearchText(entry.title) + '\n' + entry.source;
  const oldNames = new Map();
  const newNames = new Map();
  for (const [entries, names] of [[previous, oldNames], [current, newNames]]) {
    for (const entry of entries) {
      const name = key(entry);
      names.set(name, names.has(name) ? null : entry);
    }
  }
  const events = [];
  function add(kind, entry, detail) { events.push({ kind, resource: entry, detail }); }
  for (const old of previous) {
    let next = newById.get(old.id);
    if (!next && oldNames.get(key(old)) && newNames.get(key(old))) {
      next = newNames.get(key(old));
      if (saved[old.id]) add('Destination changed', next, old.hostname + ' → ' + next.hostname + '. Your saved destination is retained for review.');
    }
    if (!next) {
      if (saved[old.id]) add('Saved resource removed', old, 'No longer present in the current catalog. Removal alone does not imply a safety problem.');
      continue;
    }
    if (old.starred !== next.starred) add('Preferred status changed', next, next.starred ? 'Now starred by FMHY.' : 'No longer starred by FMHY.');
  }
  for (const entry of current) {
    if (!oldById.has(entry.id) && !oldNames.get(key(entry)) && entry.starred) add('New preferred resource', entry, entry.category);
  }
  for (const savedEntry of Object.values(saved)) {
    const before = safetyFor(savedEntry.url, oldRules);
    const after = safetyFor(savedEntry.url, newRules);
    if (after.level !== 'listed' && (before.level !== after.level || before.reason !== after.reason)) add('Saved resource warning', savedEntry, after.reason);
  }
  const priority = ['Saved resource warning', 'Saved resource removed', 'Destination changed', 'Preferred status changed', 'New preferred resource'];
  return events.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || a.resource.id.localeCompare(b.resource.id)).slice(0, 300);
}
