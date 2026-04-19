<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  comments: string[]
  loading: boolean
  generating: boolean
  parsing: boolean
  requestedCount: number
  finalCount: number
  beforeCount: number
  afterCount: number
  model: string
  requestId: string
  copiedHint: string
  canShowRaw?: boolean
  rawText?: string
}>()

const showRawDebug = defineModel<boolean>('showRawDebug')

const emit = defineEmits<{
  copyAll: []
  copyOne: [string]
  deleteOne: [number]
  exportTxt: []
  exportWord: []
  exportCsv: []
  regenerate: []
  cancel: []
}>()

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

const hasComments = computed(() => props.comments.length > 0)
const keyedComments = computed(() => {
  const seen = new Map<string, number>()

  return props.comments.map((text) => {
    const next = (seen.get(text) || 0) + 1
    seen.set(text, next)
    return {
      text,
      key: `${props.requestId || 'no-req'}::${text}::${next}`
    }
  })
})
const progressRatio = computed(() => {
  if (!props.requestedCount) return 0
  return Math.max(0, Math.min(1, props.finalCount / props.requestedCount))
})
const progressPercent = computed(() => Math.round(progressRatio.value * 100))
const loadingText = computed(() => {
  if (props.parsing) return '正在解析视频链接...'
  if (props.generating) return `AI 正在生成评论... ${progressPercent.value}%`
  return ''
})
</script>

<template>
  <section v-if="hasComments || loading" class="glass-card results-card">
    <div class="card-header">
      <div class="header-content">
        <h3 class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="16" y1="13" x2="8" y2="13" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="16" y1="17" x2="8" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="10 9 9 9 8 9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          生成结果
        </h3>
        <span class="result-count">{{ formatNumber(comments.length) }} 条</span>
      </div>

      <div class="header-actions">
        <button class="action-btn" :disabled="!hasComments" @click="emit('copyAll')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>复制全部</span>
        </button>
        <button class="action-btn" :disabled="!hasComments" @click="emit('exportTxt')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>导出TXT</span>
        </button>
        <button class="action-btn" :disabled="!hasComments" @click="emit('exportWord')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16v16H4z" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 9h10M7 13h10M7 17h6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>导出Word</span>
        </button>
        <button class="action-btn" :disabled="!hasComments" @click="emit('exportCsv')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>导出CSV</span>
        </button>
        <button class="action-btn action-btn-secondary" :disabled="generating || parsing" @click="emit('regenerate')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="1 20 1 14 7 14" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span v-if="!generating">重新生成</span>
          <span v-else>生成中...</span>
        </button>
        <button
          v-if="generating"
          class="action-btn action-btn-danger"
          @click="emit('cancel')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12" rx="2" ry="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>中断生成</span>
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="loading-animation">
        <div v-for="i in 3" :key="i" class="loading-dot" :style="{ animationDelay: `${(i - 1) * 0.15}s` }" />
      </div>
      <p class="loading-text">{{ loadingText }}</p>
      <div v-if="generating && requestedCount > 0" class="progress-wrap">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }" />
        </div>
        <p class="progress-text">{{ finalCount }} / {{ requestedCount }}</p>
      </div>
    </div>

    <!-- Success Toast -->
    <Transition name="toast">
      <div v-if="copiedHint" class="toast">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ copiedHint }}</span>
      </div>
    </Transition>

    <!-- Meta Info -->
    <div class="meta-info">
      <div class="meta-item">
        <span class="meta-label">清洗前</span>
        <span class="meta-value">{{ formatNumber(beforeCount) }}</span>
      </div>
      <div class="meta-divider" />
      <div class="meta-item">
        <span class="meta-label">清洗后</span>
        <span class="meta-value">{{ formatNumber(afterCount) }}</span>
      </div>
      <div class="meta-divider" />
      <div class="meta-item">
        <span class="meta-label">进度</span>
        <span class="meta-value">{{ finalCount }}/{{ requestedCount || comments.length }}</span>
      </div>
      <div v-if="model" class="meta-divider" />
      <div v-if="model" class="meta-item">
        <span class="meta-label">模型</span>
        <span class="meta-value model-tag">{{ model }}</span>
      </div>
    </div>

    <!-- Debug Toggle -->
    <div v-if="canShowRaw" class="debug-toggle">
      <label class="checkbox-wrapper">
        <input v-model="showRawDebug" type="checkbox">
        <span class="checkbox-custom">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="checkbox-label">显示原始输出</span>
      </label>
    </div>

    <!-- Raw Debug Output -->
    <pre v-if="showRawDebug" class="raw-output"><code>{{ rawText }}</code></pre>

    <!-- Comments List -->
    <TransitionGroup v-if="hasComments" name="list" tag="ul" class="comments-list">
      <li
        v-for="(item, index) in keyedComments"
        :key="item.key"
        class="comment-item"
      >
        <span class="comment-number">{{ index + 1 }}</span>
        <p class="comment-text">{{ item.text }}</p>
        <div class="item-actions">
          <button class="item-btn" @click="emit('copyOne', item.text)" title="复制">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="item-btn item-btn-danger" @click="emit('deleteOne', index)" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 24px rgba(8, 145, 178, 0.08);
}

.results-card {
  min-height: 300px;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #E2E8F0;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Poppins', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: #164E63;
  margin: 0;
}

.card-title svg {
  width: 22px;
  height: 22px;
  color: #0891B2;
}

.result-count {
  padding: 4px 10px;
  background: rgba(8, 145, 178, 0.1);
  color: #0891B2;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 600;
  border-radius: 20px;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  background: white;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms ease;
}

.action-btn svg {
  width: 16px;
  height: 16px;
}

.action-btn:hover:not(:disabled) {
  background: #F8FAFC;
  border-color: #CBD5E1;
  color: #164E63;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn-secondary {
  background: #F1F5F9;
  border-color: transparent;
}

.action-btn-secondary:hover:not(:disabled) {
  background: #E2E8F0;
}

.action-btn-danger {
  background: #FEE2E2;
  border-color: #FECACA;
  color: #B91C1C;
}

.action-btn-danger:hover:not(:disabled) {
  background: #FECACA;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.loading-animation {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.loading-dot {
  width: 10px;
  height: 10px;
  background: #0891B2;
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite both;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.loading-text {
  font-family: 'Open Sans', sans-serif;
  font-size: 15px;
  color: #64748B;
  margin: 0;
}

.progress-wrap {
  width: min(420px, 100%);
  margin-top: 14px;
}

.progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #E2E8F0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #06B6D4, #0EA5E9);
  transition: width 220ms ease;
}

.progress-text {
  margin-top: 6px;
  font-size: 12px;
  color: #64748B;
  text-align: center;
}

.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: #164E63;
  color: white;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
  z-index: 100;
}

.toast svg {
  width: 18px;
  height: 18px;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 300ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.meta-info {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #F8FAFC;
  border-radius: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-label {
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  color: #64748B;
}

.meta-value {
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #475569;
}

.model-tag {
  padding: 2px 8px;
  background: rgba(34, 197, 94, 0.1);
  color: #16A34A;
  border-radius: 4px;
  font-size: 12px;
}

.meta-divider {
  width: 1px;
  height: 16px;
  background: #E2E8F0;
}

.debug-toggle {
  margin-bottom: 16px;
  padding: 12px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.action-btn {
  cursor: pointer;
}

.checkbox-wrapper input {
  display: none;
}

.checkbox-custom {
  width: 18px;
  height: 18px;
  border: 2px solid #D97706;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 200ms ease;
}

.checkbox-custom svg {
  width: 12px;
  height: 12px;
  color: white;
  opacity: 0;
  transform: scale(0.5);
  transition: all 200ms ease;
}

.checkbox-wrapper input:checked + .checkbox-custom {
  background: #D97706;
}

.checkbox-wrapper input:checked + .checkbox-custom svg {
  opacity: 1;
  transform: scale(1);
}

.checkbox-label {
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  color: #92400E;
}

.raw-output {
  padding: 16px;
  background: #1E293B;
  border-radius: 10px;
  font-family: 'Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #E2E8F0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  margin: 0 0 16px 0;
}

.comments-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comment-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: white;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  transition: all 200ms ease;
}

.comment-item:hover {
  border-color: #CBD5E1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.comment-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F1F5F9;
  color: #64748B;
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  flex-shrink: 0;
}

.comment-text {
  flex: 1;
  margin: 0;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
}

.item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 200ms ease;
}

.comment-item:hover .item-actions {
  opacity: 1;
}

.item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #94A3B8;
  cursor: pointer;
  transition: all 200ms ease;
}

.item-btn svg {
  width: 16px;
  height: 16px;
}

.item-btn:hover {
  background: #F1F5F9;
  color: #475569;
}

.item-btn-danger:hover {
  background: #FEE2E2;
  color: #DC2626;
}

.list-enter-active,
.list-leave-active {
  transition: all 300ms ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

@media (max-width: 640px) {
  .glass-card {
    padding: 16px;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
  }

  .action-btn span {
    display: none;
  }

  .action-btn {
    padding: 8px;
    flex: 1;
    justify-content: center;
  }

  .meta-info {
    gap: 12px;
  }

  .meta-divider {
    display: none;
  }

  .item-actions {
    opacity: 1;
  }

  .comment-item {
    padding: 12px;
  }

  .comment-text {
    font-size: 13px;
  }
}
</style>
