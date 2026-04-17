<script setup lang="ts">
const props = defineProps<{
  mode: 'link' | 'upload'
  url: string
  loading: boolean
  parseStatus: string
  maxSizeMb?: number
  fileName?: string
  fileSize?: string
  fileType?: string
}>()

const emit = defineEmits<{
  'update:mode': ['link' | 'upload']
  'update:url': [string]
  'update:file': [File | null]
  'parse-link': []
  'file-error': [string]
}>()

const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm']

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null
  if (!file) {
    emit('update:file', null)
    return
  }

  if (!allowedTypes.includes(file.type)) {
    emit('file-error', '仅支持 mp4/mov/webm 格式')
    emit('update:file', null)
    input.value = ''
    return
  }

  const maxBytes = (props.maxSizeMb || 100) * 1024 * 1024
  if (file.size > maxBytes) {
    emit('file-error', `文件大小不能超过 ${props.maxSizeMb || 100}MB`)
    emit('update:file', null)
    input.value = ''
    return
  }

  emit('file-error', '')
  emit('update:file', file)
}
</script>

<template>
  <section class="card">
    <h2>1) 输入源</h2>
    <div class="row">
      <button :class="{ active: props.mode === 'link' }" @click="emit('update:mode', 'link')">抖音链接</button>
      <button :class="{ active: props.mode === 'upload' }" @click="emit('update:mode', 'upload')">上传视频</button>
    </div>

    <div v-if="props.mode === 'link'" class="stack">
      <input
        :value="props.url"
        placeholder="https://v.douyin.com/xxxx/"
        @input="emit('update:url', ($event.target as HTMLInputElement).value)"
      >
      <button :disabled="props.loading" @click="emit('parse-link')">解析链接</button>
      <p v-if="props.parseStatus" class="muted">{{ props.parseStatus }}</p>
    </div>

    <div v-else class="stack">
      <input type="file" accept="video/mp4,video/quicktime,video/webm" @change="onFileChange">
      <p class="muted">支持 mp4/mov/webm，最大 {{ props.maxSizeMb || 100 }}MB</p>
      <div v-if="props.fileName" class="file-info">
        <p class="muted">文件名：{{ props.fileName }}</p>
        <p class="muted">文件大小：{{ props.fileSize }}</p>
        <p class="muted">文件类型：{{ props.fileType }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.row { display: flex; gap: 8px; margin-bottom: 10px; }
.stack { display: grid; gap: 8px; }
.active { background: #111; color: #fff; }
input { padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
button { padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
.muted { color: #666; font-size: 12px; margin: 0; }
.file-info { border: 1px dashed #ddd; border-radius: 8px; padding: 8px; }
</style>
