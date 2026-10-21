const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Match answer phrases in plain text before generating HTML; never replace inside tags. */
export function formatExplanation(markdown: string, answerText = ''): string {
  const answer = answerText.trim().replace(/[。．.!！?？;；]+$/u, '');
  const phrases = [...new Set([answer, ...answer.split(/[，,。；;、\n]/u)])]
    .map(text => text.replace(/\s/g, '')).filter(text => text.length >= 2).sort((a, b) => b.length - a.length);
  const pattern = phrases.length ? new RegExp(phrases.map(text => Array.from(text).map(escapeRegex).join('\\s*')).join('|'), 'giu') : null;
  const highlight = (text: string) => {
    if (!pattern) return escapeHtml(text);
    pattern.lastIndex = 0;
    let output = '', from = 0;
    for (const match of text.matchAll(pattern)) {
      output += escapeHtml(text.slice(from, match.index)) + `<strong class="ex-answer-keyword">${escapeHtml(match[0])}</strong>`;
      from = match.index! + match[0].length;
    }
    return output + escapeHtml(text.slice(from));
  };
  return markdown.split(/\n/).map(line => {
    const list = /^\s*[-*・]\s+/.test(line);
    const plain = list ? line.replace(/^\s*[-*・]\s+/, '') : line;
    const body = plain.split(/(\*\*.+?\*\*)/g).map(part => part.startsWith('**') && part.endsWith('**') ? `<strong>${highlight(part.slice(2, -2))}</strong>` : highlight(part)).join('');
    return list ? `<li>${body}</li>` : `<p>${body}</p>`;
  }).join('');
}
