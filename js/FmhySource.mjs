import { resource, plainText } from './Resources.mjs';

export const documents = ['privacy', 'ai', 'mobile', 'audio', 'beginners-guide', 'developer-tools',
  'downloading', 'educational', 'file-tools', 'gaming-tools', 'gaming', 'image-tools', 'internet-tools',
  'linux-macos', 'misc', 'non-english', 'reading', 'social-media-tools', 'storage', 'system-tools',
  'text-tools', 'torrenting', 'video-tools', 'video'];

function cleanMarkup(text) {
  return plainText(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~]/g, '').replace(/[⭐►▷🌐]/gu, ''));
}

// Only primary bullet links are resources. Description/reference links must
// never become separate catalog entries or inherit a primary link's star.
export function parseDocument(text, source) {
  if (typeof text !== 'string' || !text.length || text.length > 3 * 1024 * 1024) throw new Error('Invalid document size');
  const entries = new Map();
  const headings = [];
  let headingCount = 0;
  let candidates = 0;
  for (const line of text.split('\n')) {
    if (line.length > 12000) throw new Error('Oversized source line');
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      headings.length = heading[1].length - 1;
      headings.push(cleanMarkup(heading[2]));
      headingCount++;
      continue;
    }
    const bullet = /^\s*[-*]\s+(?:⭐\s*)?(?:\*\*)?\[([^\]\n]{1,300})\]\(/u.exec(line);
    if (!bullet) continue;
    candidates++;
    const start = bullet[0].length;
    let depth = 1;
    let end = start;
    for (; end < line.length && depth; end++) {
      if (line[end] === '(') depth++;
      else if (line[end] === ')') depth--;
      if (depth > 8) break;
    }
    if (depth !== 0 || !headings.length) continue;
    const value = resource({ title: cleanMarkup(bullet[1]), url: line.slice(start, end - 1),
      description: cleanMarkup(line.slice(end).replace(/^\*\*/, '').replace(/^\s*-\s*/, '')),
      category: headings.filter(Boolean).join(' › '), source, starred: /^\s*[-*]\s+⭐/u.test(line) });
    if (value) {
      const previous = entries.get(value.id);
      entries.set(value.id, previous ? Object.assign({}, previous, { starred: previous.starred || value.starred }) : value);
    }
  }
  if (!headingCount || !entries.size || (candidates > 20 && entries.size / candidates < 0.45)) throw new Error('Unrecognized catalog structure');
  return Array.from(entries.values());
}

export function fetchPlan(catalogRevision, safetyRevision) {
  if (![catalogRevision, safetyRevision].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('Invalid upstream revision');
  return documents.map(name => ({ kind: 'catalog', name: name + '.md',
    url: 'https://raw.githubusercontent.com/fmhy/edit/' + catalogRevision + '/docs/' + name + '.md' }))
    .concat(['sitelist.txt', 'sitelist-plus.txt', 'filterlists-reasons.json'].map(name => ({ kind: 'safety', name,
      url: 'https://raw.githubusercontent.com/fmhy/FMHYFilterlist/' + safetyRevision + '/' + name })));
}

export function downloadArguments(url) {
  const revision = /^https:\/\/api\.github\.com\/repos\/fmhy\/(edit|FMHYFilterlist)\/commits\/main$/;
  const data = /^https:\/\/raw\.githubusercontent\.com\/fmhy\/(?:edit\/[a-f0-9]{40}\/docs\/[a-z-]+\.md|FMHYFilterlist\/[a-f0-9]{40}\/(?:sitelist(?:-plus)?\.txt|filterlists-reasons\.json))$/;
  if (!revision.test(url) && !data.test(url)) throw new Error('Unapproved download endpoint');
  // curl is the transport only: no redirects, user curlrc, shell, pipelines,
  // parsing or disk writes. Qt XHR cannot enforce these transport bounds.
  return ['curl', '--disable', '--proto', '=https', '--max-redirs', '0', '--max-filesize', '3145728',
    '--max-time', '30', '--connect-timeout', '8', '--fail', '--silent', '--show-error', '--url', url];
}
