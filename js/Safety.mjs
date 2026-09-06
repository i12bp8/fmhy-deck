import { validateExternalUrl } from './UrlSafety.mjs';
import { plainText } from './Resources.mjs';

export function buildSafetyIndex(unsafe, caution, reasonsText) {
  const reasons = JSON.parse(reasonsText);
  if (!reasons || Array.isArray(reasons) || typeof reasons !== 'object' || Object.keys(reasons).length > 10000) throw new Error('Invalid warning reasons');
  const rules = Object.create(null);
  for (const [text, level] of [[caution, 'caution'], [unsafe, 'warning']]) {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('Invalid warning list');
    let count = 0;
    for (const line of text.split('\n')) {
      const domain = line.trim().toLowerCase();
      if (!domain || domain.startsWith('!')) continue;
      const parsed = validateExternalUrl('https://' + domain + '/');
      if (!parsed || parsed.hostname !== domain) throw new Error('Unrecognized warning rule');
      rules[domain] = { level, reason: plainText(reasons[domain], 800) ||
        (level === 'warning' ? 'Flagged by FMHY’s unsafe site list.' : 'Not recommended or potentially unsafe according to FMHY’s extended list.') };
      count++;
    }
    if (!count) throw new Error('Empty warning list');
  }
  return rules;
}

export function safetyFor(url, rules) {
  const parsed = validateExternalUrl(url);
  if (!parsed) return { level: 'blocked', reason: 'Unsupported or malformed destination.' };
  let domain = parsed.hostname;
  let match = null;
  while (domain.includes('.')) {
    const rule = rules[domain];
    if (rule && (!match || rule.level === 'warning')) match = rule;
    domain = domain.slice(domain.indexOf('.') + 1);
  }
  if (match) return match;
  if (parsed.hostname.endsWith('.onion')) return { level: 'caution',
    reason: 'This onion service requires a Tor-compatible browser. Verify that your browser routes .onion addresses through Tor before opening.' };
  if (parsed.scheme === 'http') return { level: 'caution',
    reason: 'This destination uses unencrypted HTTP. Other devices on the network may read or alter the connection.' };
  return { level: 'listed', reason: 'No known FMHY warning in the last downloaded lists. This is not a security guarantee.' };
}
