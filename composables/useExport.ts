function today() {
  return new Date().toISOString().slice(0, 10)
}

function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeCsv(value: string) {
  const sanitized = value.replace(/\r?\n/g, ' ')
  return `"${sanitized.replaceAll('"', '""')}"`
}

export function formatExportLines(comments: string[]) {
  return comments
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
}

export function buildWordExportHtml(comments: string[]) {
  const lines = formatExportLines(comments)
  const body = lines.length
    ? escapeHtml(lines.join('\n'))
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Comment Lab Export</title>
  <style>
    body {
      font-family: "Microsoft YaHei", Arial, sans-serif;
      margin: 24px;
      white-space: pre-wrap;
      line-height: 1.8;
    }
  </style>
</head>
<body>${body}</body>
</html>`
}

async function copyTextWithFallback(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // fallthrough to legacy copy
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持复制')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!ok) throw new Error('复制失败')
}

export function useExport() {
  async function copyAll(comments: string[]) {
    await copyTextWithFallback(comments.join('\n'))
  }

  function exportTxt(comments: string[]) {
    const lines = formatExportLines(comments)
    downloadText(`comments_${today()}_${lines.length}.txt`, lines.join('\n'))
  }

  function exportWord(comments: string[]) {
    const lines = formatExportLines(comments)
    downloadText(
      `comments_${today()}_${lines.length}.doc`,
      buildWordExportHtml(lines),
      'application/msword;charset=utf-8'
    )
  }

  function exportCsv(comments: string[]) {
    const rows = ['index,text', ...comments.map((text, idx) => `${idx + 1},${escapeCsv(text)}`)]
    downloadText(`comments_${today()}_${comments.length}.csv`, rows.join('\n'), 'text/csv;charset=utf-8')
  }

  return {
    copyAll,
    exportTxt,
    exportWord,
    exportCsv
  }
}
