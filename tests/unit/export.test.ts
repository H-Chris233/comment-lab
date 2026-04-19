import { describe, expect, it } from 'vitest'
import { buildWordExportHtml, formatExportLines } from '../../composables/useExport'

describe('export formatting', () => {
  it('TXT 和 Word 都按一行一条输出，并去掉首尾空白', () => {
    const lines = formatExportLines(['  第一条  ', '', '第二条', '   第三条'])

    expect(lines).toEqual(['第一条', '第二条', '第三条'])
    expect(buildWordExportHtml(lines)).toContain('第一条\n第二条\n第三条')
  })

  it('Word 导出会转义特殊字符', () => {
    const html = buildWordExportHtml(['A&B', '<tag>', '"quote"'])

    expect(html).toContain('A&amp;B')
    expect(html).toContain('&lt;tag&gt;')
    expect(html).toContain('&quot;quote&quot;')
  })
})
