// Tiny, dependency-free markdown renderer for the notes preview. HTML is
// escaped FIRST, so user content can never inject markup — only our own
// generated tags survive. Supports headings, bold, italic, inline code,
// fenced code, unordered lists, and links rendered as plain text.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-700 px-1">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // [text](url) -> text (we never make live links in an offline vault)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        closeList();
        out.push('<pre class="rounded bg-slate-900 p-2 overflow-x-auto"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      const size = level === 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm";
      out.push(`<div class="${size} font-semibold mt-2">${inline(h[2])}</div>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="list-disc pl-5">');
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }

    closeList();
    if (line.trim() === "") out.push("<br/>");
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}
