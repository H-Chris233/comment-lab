const EMOJI_SEQUENCE_RE = /(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*|[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2})/gu

export function findEmojiMatches(line: string) {
  return Array.from(line.matchAll(EMOJI_SEQUENCE_RE)).map((match) => ({
    value: match[0],
    index: match.index ?? 0,
    length: match[0].length
  }))
}

export function stripAllEmoji(line: string) {
  return line.replace(EMOJI_SEQUENCE_RE, '')
}

export function countEmojiSequences(line: string) {
  return line.match(EMOJI_SEQUENCE_RE)?.length ?? 0
}

export function endsWithEmojiSequence(line: string) {
  const matches = findEmojiMatches(line)
  if (!matches.length) return false

  const lastMatch = matches[matches.length - 1]
  return lastMatch.index + lastMatch.length === line.length
}

export function countTextLengthWithoutEmoji(line: string) {
  return stripAllEmoji(line).length
}

const LENGTH_IGNORE_RE = /[\s\u3000。．.!！？?、,，：:；;…·\-—~～"'“”‘’（）()【】\[\]<>《》]/g

export function countVisibleLengthWithoutEmojiAndPunctuation(line: string) {
  return stripAllEmoji(line).replace(LENGTH_IGNORE_RE, '').length
}

export function keepEmojiBudget(line: string, keepCount: number) {
  if (keepCount <= 0) return stripAllEmoji(line)

  let seen = 0
  return line.replace(EMOJI_SEQUENCE_RE, (match) => {
    seen += 1
    return seen <= keepCount ? match : ''
  })
}
