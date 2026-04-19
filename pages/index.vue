<script setup lang="ts">
import AppHeader from '~/components/AppHeader.vue'
import SourceInput from '~/components/SourceInput.vue'
import PromptEditor from '~/components/PromptEditor.vue'
import GenerationPanel from '~/components/GenerationPanel.vue'
import ResultsPanel from '~/components/ResultsPanel.vue'
import { useExport } from '~/composables/useExport'
import { useGenerate } from '~/composables/useGenerate'
import { DEFAULT_EXTRA_PROMPT, DEFAULT_PROMPT } from '~/types/prompt'
import { shouldShowDebugRaw } from '~/utils/env'

const mode = ref<'link' | 'upload'>('link')
const url = ref('')
const file = ref<File | null>(null)
const basePrompt = ref(DEFAULT_PROMPT)
const extraPrompt = ref(DEFAULT_EXTRA_PROMPT)
const count = ref(60)
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
  rawPromptTrace,
  parseLink,
  generate,
  regenerate,
  cancelGenerate,
  requestedCount,
  finalCount,
  beforeNormalizeCount,
  afterNormalizeCount,
  model,
  requestId
} = useGenerate()

const { copyAll, exportTxt, exportWord, exportCsv } = useExport()

const fileMeta = computed(() => {
  if (!file.value) return { name: '', size: '', type: '' }
  const kb = file.value.size / 1024
  const size = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`
  return { name: file.value.name, size, type: file.value.type || '-' }
})

const canShowRaw = computed(() => shouldShowDebugRaw(Boolean(runtimeConfig.public.debugRawEnabled), rawText.value, rawPromptTrace.value))

const isLoading = computed(() => parsing.value || generating.value)
const hasComments = computed(() => comments.value.length > 0)

const generationState = computed(() => {
  if (!hasComments.value && !isLoading.value) return 'input'
  if (isLoading.value) return 'processing'
  return 'results'
})


onMounted(async () => {
  try {
    const res = await fetch('/default-prompt.txt')
    if (!res.ok) return

    const text = (await res.text()).trim()
    if (text) {
      basePrompt.value = text
    }
  } catch {
    // ignore and keep fallback DEFAULT_PROMPT
  }
})

async function handleParseLink() {
  parseStatus.value = ''
  const res = await parseLink(url.value)
  if (!res.ok) {
    parseStatus.value = res.message || '链接解析失败，请稍后重试'
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
    dedupe: dedupe.value,
    cleanEmpty: cleanEmpty.value
  })
}

async function handleRegenerate() {
  await regenerate()
}

function handleCancelGenerate() {
  cancelGenerate()
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
  <div class="page-wrapper">
    <AppHeader />

    <main class="main-content">
      <div class="container">
        <!-- Error Alert -->
        <Transition name="fade">
          <div v-if="error" class="error-alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="8" x2="12" y2="12" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="16" x2="12.01" y2="16" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="error-content">
              <p class="error-title">出错了</p>
              <p class="error-message">{{ error }} <span v-if="errorCode" class="error-code">({{ errorCode }})</span></p>
            </div>
          </div>
        </Transition>

        <!-- Input Section -->
        <div class="sections-wrapper">
          <SourceInput
            v-model:mode="mode"
            v-model:url="url"
            :loading="isLoading"
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

          <GenerationPanel
            v-model:count="count"
            v-model:dedupe="dedupe"
            v-model:clean-empty="cleanEmpty"
            :loading="isLoading"
            @generate="handleGenerate"
          />
        </div>

        <!-- Results Section -->
        <ResultsPanel
          v-if="generationState !== 'input'"
          v-model:show-raw-debug="showRawDebug"
          :comments="comments"
          :loading="isLoading"
          :generating="generating"
          :parsing="parsing"
          :requested-count="requestedCount"
          :final-count="finalCount"
          :before-count="beforeNormalizeCount"
          :after-count="afterNormalizeCount"
          :model="model"
          :request-id="requestId"
          :copied-hint="copiedHint"
          :can-show-raw="canShowRaw"
          :raw-text="rawText"
          :raw-prompt-trace="rawPromptTrace"
          @copy-all="handleCopyAll"
          @copy-one="handleCopyOne"
          @delete-one="handleDeleteOne"
          @export-txt="exportTxt(comments)"
          @export-word="exportWord(comments)"
          @export-csv="exportCsv(comments)"
          @regenerate="handleRegenerate"
          @cancel="handleCancelGenerate"
        />
      </div>
    </main>

    <footer class="app-footer">
      <p>Comment Lab · AI 驱动的评论生成工具</p>
    </footer>
  </div>
</template>

<style>
/* Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap');

/* Reset & Base */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #ECFEFF 0%, #F0F9FF 50%, #EFF6FF 100%);
  min-height: 100vh;
  color: #164E63;
  line-height: 1.5;
}

.page-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main-content {
  flex: 1;
  padding: 0 16px 40px;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sections-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Error Alert */
.error-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: #FEE2E2;
  border: 1px solid #FECACA;
  border-radius: 12px;
  animation: slideDown 300ms ease;
}

.error-alert svg {
  width: 20px;
  height: 20px;
  color: #DC2626;
  flex-shrink: 0;
}

.error-content {
  flex: 1;
}

.error-title {
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #7F1D1D;
  margin: 0 0 4px 0;
}

.error-message {
  font-size: 13px;
  color: #991B1B;
  margin: 0;
}

.error-code {
  font-family: 'Mono', monospace;
  opacity: 0.7;
}

/* Footer */
.app-footer {
  padding: 24px;
  text-align: center;
  border-top: 1px solid rgba(8, 145, 178, 0.1);
}

.app-footer p {
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  color: #94A3B8;
  margin: 0;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: all 300ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Scrollbar Styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #F1F5F9;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #94A3B8;
}

/* Focus Visible */
*:focus-visible {
  outline: 2px solid #0891B2;
  outline-offset: 2px;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid #0891B2;
  outline-offset: 2px;
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Mobile Responsive */
@media (max-width: 640px) {
  .main-content {
    padding: 0 12px 32px;
  }

  .container {
    gap: 16px;
  }
}
</style>
