<script setup lang="ts">
import CommentList from '~/components/CommentList.vue'
import GeneratePanel from '~/components/GeneratePanel.vue'
import PromptEditor from '~/components/PromptEditor.vue'
import ResultToolbar from '~/components/ResultToolbar.vue'
import VideoInput from '~/components/VideoInput.vue'
import { useExport } from '~/composables/useExport'
import { useGenerate } from '~/composables/useGenerate'
import { DEFAULT_EXTRA_PROMPT, DEFAULT_PROMPT } from '~/types/prompt'
import { shouldShowDebugRaw } from '~/utils/env'

const mode = ref<'link' | 'upload'>('upload')
const url = ref('')
const file = ref<File | null>(null)
const basePrompt = ref(DEFAULT_PROMPT)
const extraPrompt = ref(DEFAULT_EXTRA_PROMPT)
const count = ref(100)
const outputFormat = ref<'text' | 'json'>('text')
const dedupe = ref(true)
const cleanEmpty = ref(true)
const parseStatus = ref('')
const copiedHint = ref('')
const showRawDebug = ref(false)
const runtimeConfig = useRuntimeConfig()

const {
  parsing,
  generating,
  error,
  errorCode,
  comments,
  rawText,
  parseLink,
  generate,
  regenerate,
  requestedCount,
  finalCount,
  beforeNormalizeCount,
  afterNormalizeCount,
  model,
  requestId
} = useGenerate()

const { copyAll, exportTxt, exportCsv } = useExport()

const fileMeta = computed(() => {
  if (!file.value) return { name: '', size: '', type: '' }
  const kb = file.value.size / 1024
  const size = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`
  return { name: file.value.name, size, type: file.value.type || '-' }
})


const canShowRaw = computed(() => Boolean(runtimeConfig.public.debugRawEnabled))
const visibleRawDebug = computed(() => showRawDebug.value && shouldShowDebugRaw(canShowRaw.value, rawText.value))

const loadingText = computed(() => {
  if (parsing.value) return '解析链接中...'
  if (generating.value && mode.value === 'upload') return '上传处理中并生成中...'
  if (generating.value) return '生成中...'
  return ''
})

async function handleParseLink() {
  parseStatus.value = ''
  const res = await parseLink(url.value)
  if (!res.ok) {
    parseStatus.value = res.message || '链接解析失败，请改为上传视频'
    mode.value = 'upload'
    return
  }

  parseStatus.value = '解析成功，可直接生成'
}

async function handleGenerate() {
  if (generating.value) return

  if (mode.value === 'link' && !url.value.trim()) {
    parseStatus.value = '请先输入抖音链接'
    return
  }
  if (mode.value === 'upload' && !file.value) {
    parseStatus.value = '请先上传视频文件'
    return
  }

  await generate({
    mode: mode.value,
    url: url.value,
    file: file.value,
    count: count.value,
    basePrompt: basePrompt.value,
    extraPrompt: extraPrompt.value,
    outputFormat: outputFormat.value,
    dedupe: dedupe.value,
    cleanEmpty: cleanEmpty.value
  })
}

async function handleRegenerate() {
  await regenerate()
}

async function handleCopyAll() {
  await copyAll(comments.value)
  copiedHint.value = '已复制到剪贴板'
  setTimeout(() => (copiedHint.value = ''), 2000)
}

async function handleCopyOne(text: string) {
  await navigator.clipboard.writeText(text)
  copiedHint.value = '已复制单条评论'
  setTimeout(() => (copiedHint.value = ''), 2000)
}

function handleDeleteOne(index: number) {
  comments.value.splice(index, 1)
}

function handleFileError(msg: string) {
  parseStatus.value = msg
}
</script>

<template>
  <main class="container">
    <h1>Comment Lab</h1>

    <VideoInput
      v-model:mode="mode"
      v-model:url="url"
      :loading="parsing || generating"
      :parse-status="parseStatus"
      :file-name="fileMeta.name"
      :file-size="fileMeta.size"
      :file-type="fileMeta.type"
      :max-size-mb="100"
      @update:file="file = $event"
      @parse-link="handleParseLink"
      @file-error="handleFileError"
    />

    <PromptEditor
      v-model:base-prompt="basePrompt"
      v-model:extra-prompt="extraPrompt"
    />

    <GeneratePanel
      v-model:count="count"
      v-model:output-format="outputFormat"
      v-model:dedupe="dedupe"
      v-model:clean-empty="cleanEmpty"
      :loading="generating"
      @generate="handleGenerate"
    />

    <p v-if="loadingText" class="loading">{{ loadingText }}</p>
    <p v-if="error" class="error">{{ error }} <small v-if="errorCode">({{ errorCode }})</small></p>

    <section class="card">
      <h2>4) 结果</h2>
      <p class="meta">
        请求数量：{{ requestedCount }} ｜ 实际返回：{{ finalCount }} ｜ 清洗前：{{ beforeNormalizeCount }} ｜ 清洗后：{{ afterNormalizeCount }} ｜ 模型：{{ model || '-' }}
      </p>
      <p v-if="requestId" class="meta">Request ID：{{ requestId }}</p>
      <div v-if="canShowRaw" class="debug-row">
        <label><input v-model="showRawDebug" type="checkbox"> 调试模式：显示原始模型输出</label>
      </div>
      <pre v-if="visibleRawDebug" class="raw-box">{{ rawText }}</pre>
      <ResultToolbar
        :count="comments.length"
        :before-count="beforeNormalizeCount"
        :after-count="afterNormalizeCount"
        :copied-hint="copiedHint"
        :loading="generating"
        @copy="handleCopyAll"
        @txt="exportTxt(comments)"
        @csv="exportCsv(comments)"
        @regenerate="handleRegenerate"
      />
      <CommentList :comments="comments" @copy-one="handleCopyOne" @delete-one="handleDeleteOne" />
    </section>
  </main>
</template>

<style scoped>
.container { max-width: 900px; margin: 0 auto; padding: 16px; }
.card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.error { color: #d00; font-weight: 600; }
.loading { color: #2f6fdd; font-weight: 600; }
.meta { color: #666; font-size: 12px; margin: 6px 0; }
.debug-row { margin: 8px 0; color: #444; font-size: 13px; }
.raw-box { background: #fafafa; border: 1px dashed #ddd; border-radius: 8px; padding: 8px; max-height: 240px; overflow: auto; white-space: pre-wrap; }
</style>
