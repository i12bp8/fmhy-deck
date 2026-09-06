// A deliberately narrow RFC 3986 HTTP URL subset, shared by QML and the worker.
// QML has no WHATWG URL implementation. Reject ambiguous browser spellings
// instead of allowing Qt and the browser to disagree about the authority.
export function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.length) return null;
  if (/[\s\u0000-\u001f\u007f-\u009f\\<>"`]/u.test(value) || /%(?![\da-f]{2})/i.test(value)) return null;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return null;
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value);
  if (!match) return null;
  const authority = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(match[2]);
  if (!authority) return null;
  const hostname = authority[1].toLowerCase();
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || labels.some(label =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  // Numeric/hexadecimal host endings can invoke browsers' legacy IPv4 parser.
  if (!/[a-z]/i.test(labels[labels.length - 1]) || /^0x[\da-f]+$/i.test(labels[labels.length - 1])) return null;
  const port = authority[2] ? Number(authority[2]) : 0;
  if (authority[2] && (port < 1 || port > 65535)) return null;
  const scheme = match[1].toLowerCase();
  const suffix = port && !((scheme === 'https' && port === 443) || (scheme === 'http' && port === 80)) ? ':' + port : '';
  const path = match[3] || '/';
  // Canonicalize literal dot segments; encoded ones are rejected to keep identity exact.
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(path) || /%2e/i.test(path)) return null;
  return { url: scheme + '://' + hostname + suffix + path + (match[4] || '') + (match[5] || ''), hostname, scheme };
}

export function openArguments(value) {
  const parsed = validateExternalUrl(value);
  return parsed ? ['xdg-open', parsed.url] : null;
}
