// Turns a Markdown answer into text that sounds right when read aloud.
export function toSpeech(markdown: string, codePlaceholder: string): string {
  const placeholder = codePlaceholder.trim()
  const codeLine = placeholder === '' ? '' : `${placeholder}。`

  return (
    markdown
      .replace(/\r\n/g, '\n')
      // Fenced code blocks (``` or ~~~, any language tag), whole
      .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, codeLine)
      // An unclosed fence at the end (a cut-off answer)
      .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, codeLine)
      // Markdown tables: drop the rows
      .replace(/^[ \t]*\|.*\|[ \t]*$/gm, '')
      // Images, then links: keep the label
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Bare URLs
      .replace(/https?:\/\/[^\s)）」』]+/g, 'リンク')
      // Inline code: keep what is inside
      .replace(/`([^`\n]+)`/g, '$1')
      // HTML tags
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      // Headings, quotes, list markers, rules
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
      .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
      // Emphasis and strikethrough
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      // Tidy whitespace
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
