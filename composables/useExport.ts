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
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string) {
  const sanitized = value.replace(/\r?\n/g, ' ')
  return `"${sanitized.replaceAll('"', '""')}"`
}

export function useExport() {
  async function copyAll(comments: string[]) {
    await navigator.clipboard.writeText(comments.join('\n'))
  }

  function exportTxt(comments: string[]) {
    downloadText(`comments_${today()}_${comments.length}.txt`, comments.join('\n'))
  }

  function exportCsv(comments: string[]) {
    const rows = ['index,text', ...comments.map((text, idx) => `${idx + 1},${escapeCsv(text)}`)]
    downloadText(`comments_${today()}_${comments.length}.csv`, rows.join('\n'), 'text/csv;charset=utf-8')
  }

  return {
    copyAll,
    exportTxt,
    exportCsv
  }
}
