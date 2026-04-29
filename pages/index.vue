<script setup lang="ts">
import AppHeader from '~/components/AppHeader.vue'
import SourceInput from '~/components/SourceInput.vue'
import PromptEditor from '~/components/PromptEditor.vue'
import GenerationPanel from '~/components/GenerationPanel.vue'
import ResultsPanel from '~/components/ResultsPanel.vue'
import { useExport } from '~/composables/useExport'
import { useGenerate } from '~/composables/useGenerate'
import { DEFAULT_MODEL, DEFAULT_PROMPT, MODEL_OPTIONS, supportsThinkingMode, type ModelOption } from '~/types/prompt'
import { shouldShowDebugRaw } from '~/utils/env'

const mode = ref<'link' | 'upload'>('link')
const runtimeConfig = useRuntimeConfig()
const allowedModels = new Set<ModelOption>(MODEL_OPTIONS.map((option) => option.value))
function isAllowedModel(value: string): value is ModelOption {
  return allowedModels.has(value as ModelOption)
}
const selectedModel = ref<ModelOption>(
  isAllowedModel(runtimeConfig.public.defaultModel) ? runtimeConfig.public.defaultModel : DEFAULT_MODEL
)
const fixedInputMode: 'file' = 'file'
const url = ref('')
const file = ref<File | null>(null)
const basePrompt = ref(DEFAULT_PROMPT)
const count = ref(100)
const dedupe = ref(true)
const cleanEmpty = ref(true)
const enableThinking = ref(false)
const parseStatus = ref('')
const copiedHint = ref('')
const showRawDebug = ref(false)
const isPasswordModalOpen = ref(false)
const sidecarStartupError = ref('')
const sidecarStartupStatus = ref('')
const desktopDiagnostics = ref<{ app_log_dir: string; sidecar_log_path: string; sidecar_base_url: string } | null>(null)
const localSettings = ref({
  aliyunApiKey: '',
  aliyunBaseUrl: '',
  tikhubApiKey: '',
  pythonServiceUrl: '',
  aliyunModel: '',
  generateTimeoutMs: 3600000,
  debugRawEnabled: false
})
const settingsSaving = ref(false)
const settingsNotice = ref('')

const {
  parsing,
  generating,
  error,
  errorCode,
  errorDetail,
  comments,
  rawText,
  rawPromptTrace,
  parseLink,
  generate,
  regenerate,
  cancelGenerate,
  shuffleComments,
  requestedCount,
  finalCount,
  beforeNormalizeCount,
  afterNormalizeCount,
  model,
  requestId,
  statusText,
  statusPhase
} = useGenerate()

const { copyAll, exportTxt, exportWord } = useExport()

const fileMeta = computed(() => {
  if (!file.value) return { name: '', size: '', type: '' }
  const kb = file.value.size / 1024
  const size = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`
  return { name: file.value.name, size, type: file.value.type || '-' }
})

const canShowRaw = computed(() => shouldShowDebugRaw(
  Boolean(runtimeConfig.public.debugRawEnabled) || Boolean(localSettings.value.debugRawEnabled),
  rawText.value,
  rawPromptTrace.value
))
const isLoading = computed(() => parsing.value || generating.value)
const hasComments = computed(() => comments.value.length > 0)
const thinkingSupported = computed(() => supportsThinkingMode(selectedModel.value))

const generationState = computed(() => {
  if (!hasComments.value && !isLoading.value) return 'input'
  if (isLoading.value) return 'processing'
  return 'results'
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

  const result = await generate({
    mode: mode.value,
    inputMode: fixedInputMode,
    model: selectedModel.value,
    url: url.value,
    file: file.value,
    count: count.value,
    basePrompt: basePrompt.value,
    dedupe: dedupe.value,
    cleanEmpty: cleanEmpty.value,
    enableThinking: thinkingSupported.value ? enableThinking.value : false
    ,
    timeoutMs: localSettings.value.generateTimeoutMs
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

function handleShuffleAll() {
  shuffleComments()
}

function handleFileError(msg: string) {
  parseStatus.value = msg
}

function openPasswordModal() {
  isPasswordModalOpen.value = true
}

function closePasswordModal() {
  isPasswordModalOpen.value = false
}

async function loadLocalSettings() {
  const res = await $fetch<any>('/api/settings').catch(() => null)
  const data = res?.ok ? (res.data || {}) : {}
  localSettings.value = {
    aliyunApiKey: data.aliyunApiKey || '',
    aliyunBaseUrl: data.aliyunBaseUrl || '',
    tikhubApiKey: data.tikhubApiKey || '',
    pythonServiceUrl: data.pythonServiceUrl || '',
    aliyunModel: data.aliyunModel || '',
    generateTimeoutMs: Number(data.generateTimeoutMs || 3600000),
    debugRawEnabled: Boolean(data.debugRawEnabled)
  }
  if (localSettings.value.aliyunModel && isAllowedModel(localSettings.value.aliyunModel)) {
    selectedModel.value = localSettings.value.aliyunModel as ModelOption
  }
}

async function saveLocalSettings() {
  settingsNotice.value = ''
  settingsSaving.value = true
  try {
    const res = await $fetch<any>('/api/settings', {
      method: 'POST',
      body: localSettings.value
    })
    if (res?.ok) {
      if (localSettings.value.aliyunModel && isAllowedModel(localSettings.value.aliyunModel)) {
        selectedModel.value = localSettings.value.aliyunModel as ModelOption
      }
      settingsNotice.value = '设置已保存（本机生效）'
    } else {
      settingsNotice.value = '设置保存失败'
    }
  } catch {
    settingsNotice.value = '设置保存失败'
  } finally {
    settingsSaving.value = false
  }
}

async function loadDesktopDiagnostics() {
  if (!process.client) return
  const isDesktop = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
  if (!isDesktop) return
  const { invoke } = await import('@tauri-apps/api/core')
  const diagnostics = await invoke<{ app_log_dir: string; sidecar_log_path: string; sidecar_base_url: string }>('get_desktop_diagnostics').catch(() => null)
  if (diagnostics) desktopDiagnostics.value = diagnostics
}

async function exportSidecarLog() {
  if (!process.client) return
  const isDesktop = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
  if (!isDesktop) return
  const { invoke } = await import('@tauri-apps/api/core')
  const content = await invoke<string>('read_sidecar_log').catch(() => '')
  if (!content) {
    settingsNotice.value = '侧车日志为空或读取失败'
    return
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `python-sidecar-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(url)
  settingsNotice.value = '侧车日志已导出'
}

async function copySidecarLogPath() {
  const path = desktopDiagnostics.value?.sidecar_log_path
  if (!path) return
  await navigator.clipboard.writeText(path)
  settingsNotice.value = '日志路径已复制'
}

async function openLogDir() {
  if (!process.client) return
  const isDesktop = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
  if (!isDesktop) return
  const { invoke } = await import('@tauri-apps/api/core')
  const ok = await invoke('open_app_log_dir').then(() => true).catch(() => false)
  settingsNotice.value = ok ? '已打开日志目录' : '打开日志目录失败'
}

function handlePasswordModalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isPasswordModalOpen.value) {
    closePasswordModal()
  }
}

watch(isPasswordModalOpen, (open) => {
  if (!process.client) return
  document.body.style.overflow = open ? 'hidden' : ''
})

watch(thinkingSupported, (supported) => {
  if (!supported && enableThinking.value) {
    enableThinking.value = false
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (!process.client) return
  document.body.style.overflow = ''
  window.removeEventListener('keydown', handlePasswordModalKeydown)
})

onMounted(() => {
  if (!process.client) return
  window.addEventListener('keydown', handlePasswordModalKeydown)
  void loadLocalSettings()
  void loadDesktopDiagnostics()
  if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
    import('@tauri-apps/api/event').then(({ listen }) => {
      void listen<{ message?: string; log_path?: string }>('sidecar-error', (event) => {
        const message = event.payload?.message || 'Python 侧车启动失败'
        const logPath = event.payload?.log_path ? `（日志: ${event.payload.log_path}）` : ''
        sidecarStartupError.value = `${message}${logPath}`
      })
      void listen<{ message?: string; phase?: string; base_url?: string }>('sidecar-status', (event) => {
        sidecarStartupStatus.value = event.payload?.message || ''
        if (event.payload?.phase === 'ready') {
          sidecarStartupStatus.value = ''
          if (!localSettings.value.pythonServiceUrl && event.payload.base_url) {
            localSettings.value.pythonServiceUrl = event.payload.base_url
          }
        }
      })
    })
  }

  const storedModel = localStorage.getItem('comment-lab:selected-model')
  if (storedModel && isAllowedModel(storedModel)) {
    selectedModel.value = storedModel
  }

  watch(
    selectedModel,
    (value) => {
      if (!isAllowedModel(value)) {
        selectedModel.value = isAllowedModel(runtimeConfig.public.defaultModel)
          ? runtimeConfig.public.defaultModel
          : DEFAULT_MODEL
        return
      }
      localStorage.setItem('comment-lab:selected-model', value)
    },
    { immediate: true }
  )
})
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
              <p v-if="requestId" class="error-request-id">请求ID：{{ requestId }}</p>
              <details v-if="errorDetail" class="error-details">
                <summary>查看详细错误</summary>
                <pre>{{ errorDetail }}</pre>
              </details>
            </div>
          </div>
        </Transition>
        <Transition name="fade">
          <div v-if="sidecarStartupError" class="error-alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="8" x2="12" y2="12" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="16" x2="12.01" y2="16" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="error-content">
              <p class="error-title">侧车启动异常</p>
              <p class="error-message">{{ sidecarStartupError }}</p>
            </div>
          </div>
        </Transition>
        <Transition name="fade">
          <div v-if="sidecarStartupStatus && !sidecarStartupError" class="auth-toast">
            <span>{{ sidecarStartupStatus }}</span>
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
            :max-size-mb="1000"
            @update:file="file = $event"
            @parse-link="handleParseLink"
            @file-error="handleFileError"
          />

          <PromptEditor
            v-model:base-prompt="basePrompt"
          />

          <GenerationPanel
            v-model:count="count"
            v-model:dedupe="dedupe"
            v-model:clean-empty="cleanEmpty"
            v-model:model="selectedModel"
            v-model:enable-thinking="enableThinking"
            :thinking-supported="thinkingSupported"
            :loading="isLoading"
            @generate="handleGenerate"
          />
        </div>

        <button class="password-fab" type="button" @click="openPasswordModal">
          设置
        </button>

        <Teleport to="body">
          <Transition name="fade">
            <div
              v-if="isPasswordModalOpen"
              class="password-modal-backdrop"
              @click.self="closePasswordModal"
            >
              <div class="password-modal" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
                <div class="password-modal-head">
                  <div>
                    <h3 id="password-modal-title" class="password-modal-title">
                      设置
                    </h3>
                    <p class="password-modal-desc">
                      管理本机运行参数和日志排查入口。
                    </p>
                  </div>
                  <button class="password-modal-close" type="button" aria-label="关闭弹窗" @click="closePasswordModal">
                    ×
                  </button>
                </div>
                <div class="settings-list">
                  <div class="settings-block">
                    <p class="settings-block-title">本机运行设置</p>
                    <label class="settings-field">
                      <span>阿里云 API Key</span>
                      <input v-model="localSettings.aliyunApiKey" type="password" placeholder="留空则使用环境变量" />
                    </label>
                    <label class="settings-field">
                      <span>阿里云 Base URL</span>
                      <input v-model="localSettings.aliyunBaseUrl" type="text" placeholder="可留空" />
                    </label>
                    <label class="settings-field">
                      <span>TikHub API Key</span>
                      <input v-model="localSettings.tikhubApiKey" type="password" placeholder="留空则使用环境变量" />
                    </label>
                    <label class="settings-field">
                      <span>Python 侧车地址</span>
                      <input
                        v-model="localSettings.pythonServiceUrl"
                        type="text"
                        :placeholder="desktopDiagnostics?.sidecar_base_url || 'http://127.0.0.1:8001'"
                      />
                    </label>
                    <label class="settings-field">
                      <span>默认模型</span>
                      <select v-model="localSettings.aliyunModel">
                        <option value="">跟随页面默认</option>
                        <option v-for="option in MODEL_OPTIONS" :key="option.value" :value="option.value">
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <label class="settings-field">
                      <span>生成超时（毫秒）</span>
                      <input v-model.number="localSettings.generateTimeoutMs" type="number" min="1000" step="1000" />
                    </label>
                    <label class="settings-checkbox">
                      <input v-model="localSettings.debugRawEnabled" type="checkbox" />
                      <span>启用原始输出调试开关</span>
                    </label>
                    <button class="settings-save-btn" type="button" :disabled="settingsSaving" @click="saveLocalSettings">
                      {{ settingsSaving ? '保存中...' : '保存本机设置' }}
                    </button>
                  </div>
                  <div class="settings-block">
                    <p class="settings-block-title">侧车日志</p>
                    <p v-if="desktopDiagnostics?.sidecar_log_path" class="settings-hint">{{ desktopDiagnostics.sidecar_log_path }}</p>
                    <div class="settings-actions-row">
                      <button class="settings-secondary-btn" type="button" @click="openLogDir">打开日志目录</button>
                      <button class="settings-secondary-btn" type="button" @click="copySidecarLogPath">复制日志路径</button>
                      <button class="settings-secondary-btn" type="button" @click="exportSidecarLog">导出侧车日志</button>
                    </div>
                  </div>
                  <p v-if="settingsNotice" class="settings-notice">{{ settingsNotice }}</p>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

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
          :status-text="statusText"
          :status-phase="statusPhase"
          @copy-all="handleCopyAll"
          @copy-one="handleCopyOne"
          @delete-one="handleDeleteOne"
          @shuffle-all="handleShuffleAll"
          @export-txt="exportTxt(comments)"
          @export-word="exportWord(comments)"
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

.auth-loading-card,
.auth-shell {
  margin-top: 12px;
}

.auth-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 24px;
}

.auth-shell {
  display: flex;
  justify-content: center;
}

.auth-shell :deep(.password-card) {
  width: 100%;
  max-width: 520px;
}

.auth-logout-btn {
  border: 1px solid #CBD5E1;
  border-radius: 999px;
  background: white;
  color: #475569;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: all 160ms ease;
}

.auth-logout-btn:hover {
  border-color: #0891B2;
  color: #0891B2;
  box-shadow: 0 4px 12px rgba(8, 145, 178, 0.08);
}

.auth-toast {
  position: fixed;
  right: 24px;
  bottom: 92px;
  z-index: 55;
  max-width: min(360px, calc(100vw - 32px));
  padding: 12px 16px;
  border-radius: 999px;
  background: rgba(8, 145, 178, 0.94);
  color: white;
  box-shadow: 0 16px 32px rgba(8, 145, 178, 0.18);
  font-size: 13px;
  backdrop-filter: blur(10px);
}

.password-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 60;
  border: none;
  border-radius: 999px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #0F766E 0%, #0891B2 100%);
  color: white;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 16px 34px rgba(8, 145, 178, 0.28);
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
}

.password-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 40px rgba(8, 145, 178, 0.32);
}

.password-fab:focus-visible,
.password-modal-close:focus-visible,
.auth-logout-btn:focus-visible {
  outline: 3px solid rgba(8, 145, 178, 0.24);
  outline-offset: 2px;
}

.password-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
}

.password-modal {
  width: min(560px, 100%);
  max-height: min(90vh, 760px);
  overflow: auto;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 24px;
  box-shadow: 0 30px 80px rgba(15, 23, 42, 0.22);
  padding: 24px;
}

.password-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.password-modal-title {
  margin: 0;
  font-family: 'Poppins', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #164E63;
}

.password-modal-desc {
  margin: 8px 0 0;
  color: #64748B;
  font-size: 14px;
  line-height: 1.6;
}

.password-modal-close {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: #F1F5F9;
  color: #475569;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 160ms ease, color 160ms ease, transform 160ms ease;
}

.password-modal-close:hover {
  background: #E2E8F0;
  color: #0F172A;
  transform: rotate(90deg);
}

.password-modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.password-modal-actions-split {
  justify-content: flex-start;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-block {
  border: 1px solid #E2E8F0;
  border-radius: 16px;
  padding: 14px;
  background: #F8FAFC;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #0F172A;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.settings-field input {
  border: 1px solid #CBD5E1;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
}

.settings-field select {
  border: 1px solid #CBD5E1;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  background: white;
}

.settings-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #334155;
}

.settings-save-btn,
.settings-secondary-btn {
  border: 1px solid #CBD5E1;
  border-radius: 999px;
  background: white;
  color: #334155;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
}

.settings-save-btn {
  align-self: flex-start;
}

.settings-actions-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-hint {
  margin: 0;
  font-size: 12px;
  color: #64748B;
  word-break: break-all;
}

.settings-notice {
  margin: 0;
  font-size: 12px;
  color: #0F766E;
}

.settings-item-btn {
  width: 100%;
  border: 1px solid #D1D5DB;
  border-radius: 16px;
  background: white;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.settings-item-btn:hover {
  border-color: #0891B2;
  box-shadow: 0 10px 20px rgba(8, 145, 178, 0.1);
  transform: translateY(-1px);
}

.settings-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
}

.settings-item-desc {
  font-size: 12px;
  color: #64748B;
}

.settings-back-btn {
  border: 1px solid #CBD5E1;
  border-radius: 999px;
  background: #F8FAFC;
  color: #334155;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.settings-back-btn:hover {
  border-color: #0891B2;
  color: #0891B2;
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

.error-request-id {
  margin-top: 8px;
  font-size: 12px;
  color: #B91C1C;
}

.error-details {
  margin-top: 12px;
  color: #7F1D1D;
  font-size: 12px;
}

.error-details summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 8px;
}

.error-details pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(248, 113, 113, 0.25);
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

  .auth-toast {
    right: 12px;
    bottom: 76px;
    max-width: calc(100vw - 24px);
  }

  .password-fab {
    right: 12px;
    bottom: 12px;
    padding: 12px 16px;
  }

  .password-modal-backdrop {
    padding: 12px;
    align-items: flex-end;
  }

  .password-modal {
    max-height: calc(100vh - 24px);
    padding: 20px;
    border-radius: 20px;
  }

  .password-modal-head {
    margin-bottom: 14px;
  }
}
</style>
