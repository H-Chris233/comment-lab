import type { H3Event } from 'h3'

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export type UploadVideo = { type?: string; data?: Buffer; filename?: string }

export function getMaxVideoBytes() {
  const config = useRuntimeConfig()
  const fromConfig = Number(config.maxVideoSizeMb || process.env.MAX_VIDEO_SIZE_MB || 100)
  const mb = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : 100
  return Math.floor(mb * 1024 * 1024)
}

export function fileToBase64DataUrl(fileBuffer: Buffer, mimeType: string) {
  const base64 = fileBuffer.toString('base64')
  return `data:${mimeType};base64,${base64}`
}

export async function readMultipart(event: H3Event) {
  const form = await readMultipartFormData(event)
  if (!form?.length) {
    return []
  }
  return form
}
