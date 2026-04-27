<script setup lang="ts">
import AppHeader from '~/components/AppHeader.vue'
import PasswordPanel from '~/components/PasswordPanel.vue'
import SourceInput from '~/components/SourceInput.vue'
import PromptEditor from '~/components/PromptEditor.vue'
import GenerationPanel from '~/components/GenerationPanel.vue'
import ResultsPanel from '~/components/ResultsPanel.vue'
import { useAuth } from '~/composables/useAuth'
import { useExport } from '~/composables/useExport'
import { useGenerate } from '~/composables/useGenerate'
import { DEFAULT_MODEL, DEFAULT_PROMPT, MODEL_OPTIONS, type ModelOption } from '~/types/prompt'
import { shouldShowDebugRaw } from '~/utils/env'

const mode = ref<'link' | 'upload'>('link')
const runtimeConfig = useRuntimeConfig()
const auth = useAuth()
const authLoading = auth.loading
const authError = auth.error
const authHasPassword = auth.hasPassword
const authUnlocked = auth.unlocked
const authReady = auth.ready
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
const parseStatus = ref('')
const copiedHint = ref('')
const showRawDebug = ref(false)
const passwordNotice = ref('')
const passwordPanelKey = ref(0)
const isPasswordModalOpen = ref(false)

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
  shuffleComments,
  requestedCount,
  finalCount,
  beforeNormalizeCount,
  afterNormalizeCount,
  model,
  requestId
} = useGenerate()

const { copyAll, exportTxt, exportWord } = useExport()

await auth.loadStatus()

const fileMeta = computed(() => {
  if (!file.value) return { name: '', size: '', type: '' }
  const kb = file.value.size / 1024
  const size = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`
  return { name: file.value.name, size, type: file.value.type || '-' }
})

const canShowRaw = computed(() => shouldShowDebugRaw(Boolean(runtimeConfig.public.debugRawEnabled), rawText.value, rawPromptTrace.value))
const isUnlocked = computed(() => authUnlocked.value)

const isLoading = computed(() => parsing.value || generating.value)
const hasComments = computed(() => comments.value.length > 0)

const generationState = computed(() => {
  if (!hasComments.value && !isLoading.value) return 'input'
  if (isLoading.value) return 'processing'
  return 'results'
})


async function handleParseLink() {
  parseStatus.value = ''
  const res = await parseLink(url.value)
  if (!res.ok) {
    if (res.code === 'UNAUTHORIZED') {
      await auth.loadStatus()
    }
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
    cleanEmpty: cleanEmpty.value
  })

  if (!result.ok && result.code === 'UNAUTHORIZED') {
    await auth.loadStatus()
  }
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

async function handleLockSubmit(payload: { password: string; confirmPassword: string }) {
  passwordNotice.value = ''
  const hadPassword = authHasPassword.value
  const action = hadPassword ? auth.login : auth.setPassword
  const res = await action(payload.password, payload.confirmPassword)
  if (res.ok) {
    passwordNotice.value = hadPassword ? '密码正确，已进入主页面' : '密码已设置，已进入主页面'
  }
}

async function handleChangePassword(payload: { password: string; confirmPassword: string }) {
  passwordNotice.value = ''
  const res = await auth.changePassword(payload.password, payload.confirmPassword)
  if (res.ok) {
    passwordNotice.value = '密码已修改，当前会话继续有效'
    passwordPanelKey.value += 1
  }
}

async function handleLogout() {
  passwordNotice.value = ''
  const res = await auth.logout()
  if (res.ok) {
    passwordNotice.value = '已退出当前会话'
    await auth.loadStatus()
  }
}

function openPasswordModal() {
  passwordPanelKey.value += 1
  passwordNotice.value = ''
  isPasswordModalOpen.value = true
}

function closePasswordModal() {
  isPasswordModalOpen.value = false
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

watch(authUnlocked, (unlocked) => {
  if (!unlocked) {
    closePasswordModal()
  }
})

onBeforeUnmount(() => {
  if (!process.client) return
  document.body.style.overflow = ''
  window.removeEventListener('keydown', handlePasswordModalKeydown)
})

onMounted(() => {
  if (!process.client) return
  window.addEventListener('keydown', handlePasswordModalKeydown)

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
        <div v-if="!authReady" class="auth-loading-card glass-card">
          <div class="loading-animation">
            <div v-for="i in 3" :key="i" class="loading-dot" :style="{ animationDelay: `${(i - 1) * 0.15}s` }" />
          </div>
          <p class="loading-text">正在检查密码锁状态...</p>
        </div>

        <template v-else>
          <!-- Error Alert -->
          <Transition name="fade">
            <div v-if="error && isUnlocked" class="error-alert">
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

          <template v-if="!isUnlocked">
            <div class="auth-shell">
              <PasswordPanel
                :mode="authHasPassword ? 'login' : 'setup'"
                :loading="authLoading"
                :error="authError"
                @submit="handleLockSubmit"
              />
            </div>
          </template>

          <template v-else>
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
              />

              <GenerationPanel
                v-model:count="count"
                v-model:dedupe="dedupe"
                v-model:clean-empty="cleanEmpty"
                v-model:model="selectedModel"
                :loading="isLoading"
                @generate="handleGenerate"
              />
            </div>

            <Transition name="fade">
              <div v-if="passwordNotice" class="auth-toast">
                <span>{{ passwordNotice }}</span>
              </div>
            </Transition>

            <button class="password-fab" type="button" @click="openPasswordModal">
              修改密码
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
                        <h3 id="password-modal-title" class="password-modal-title">密码锁</h3>
                        <p class="password-modal-desc">修改后当前会话继续有效，关闭浏览器后下次会使用新密码。</p>
                      </div>
                      <button class="password-modal-close" type="button" aria-label="关闭弹窗" @click="closePasswordModal">
                        ×
                      </button>
                    </div>

                    <PasswordPanel
                      :key="passwordPanelKey"
                      mode="change"
                      :loading="authLoading"
                      :error="authError"
                      compact
                      embedded
                      @submit="handleChangePassword"
                    />

                    <div class="password-modal-actions">
                      <button class="auth-logout-btn" type="button" @click="handleLogout">
                        退出当前会话
                      </button>
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
              @copy-all="handleCopyAll"
              @copy-one="handleCopyOne"
              @delete-one="handleDeleteOne"
              @shuffle-all="handleShuffleAll"
              @export-txt="exportTxt(comments)"
              @export-word="exportWord(comments)"
              @regenerate="handleRegenerate"
              @cancel="handleCancelGenerate"
            />
          </template>
        </template>
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
