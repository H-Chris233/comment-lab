const DEFAULT_ALLOWED_EMOJI = [
  '🌹',
  '😡',
  '👋',
  '😅',
  '😂',
  '😲',
  '👍',
  '😣',
  '🤣',
  '🥀',
  '😊',
  '🙂',
  '😉',
  '😄',
  '😆',
  '😍',
  '😭',
  '🥺',
  '🙏',
  '✨',
  '🔥',
  '💯',
  '💪',
  '👌',
  '🤔',
  '😏',
  '🙃',
  '🥳',
  '🤩',
  '🙌',
  '😌',
  '😬',
  '😴'
] as const

export const ALLOWED_EMOJI_LIST = DEFAULT_ALLOWED_EMOJI
export const ALLOWED_EMOJI_TEXT = ALLOWED_EMOJI_LIST.join('')
const ALLOWED_EMOJI_SET = new Set<string>(ALLOWED_EMOJI_LIST)

const EMOJI_SEQUENCE_RE = /(?:[🌹😡👋😅😂😲👍😣🤣🥀😊🙂😉😄😆😍😭🥺🙏✨🔥💯💪👌🤔😏🙃🥳🤩🙌😌😬😴]|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu

function isAllowedEmoji(match: string) {
  return ALLOWED_EMOJI_SET.has(match)
}

export function findAllowedEmojiMatches(line: string) {
  return Array.from(line.matchAll(EMOJI_SEQUENCE_RE))
    .filter((match) => isAllowedEmoji(match[0]))
    .map((match) => ({
      value: match[0],
      index: match.index ?? 0,
      length: match[0].length
    }))
}

export function stripDisallowedEmoji(line: string) {
  return line.replace(EMOJI_SEQUENCE_RE, (match) => (isAllowedEmoji(match) ? match : ''))
}

export function stripAllEmoji(line: string) {
  return line.replace(EMOJI_SEQUENCE_RE, '')
}

export function countEmojiSequences(line: string) {
  return line.match(EMOJI_SEQUENCE_RE)?.length ?? 0
}

export function countTextLengthWithoutEmoji(line: string) {
  return stripAllEmoji(line).length
}

export function countAllowedEmoji(line: string) {
  return (line.match(EMOJI_SEQUENCE_RE) || []).filter(isAllowedEmoji).length
}

export function keepAllowedEmojiBudget(line: string, keepCount: number) {
  if (keepCount <= 0) return stripAllEmoji(line)

  let seen = 0
  return line.replace(EMOJI_SEQUENCE_RE, (match) => {
    if (!isAllowedEmoji(match)) return ''
    seen += 1
    return seen <= keepCount ? match : ''
  })
}
