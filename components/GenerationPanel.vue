<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MODEL_OPTIONS } from '~/types/prompt'

const props = defineProps<{
  count: number
  dedupe: boolean
  cleanEmpty: boolean
  model: string
  enableThinking: boolean
  thinkingSupported: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  'update:count': [number]
  'update:dedupe': [boolean]
  'update:cleanEmpty': [boolean]
  'update:model': [string]
  'update:enableThinking': [boolean]
  generate: []
}>()

const countOptions = [100, 200, 300]
const isCustomCount = ref(!countOptions.includes(props.count))
const customCount = ref(props.count)

watch(
  () => props.count,
  (value) => {
    isCustomCount.value = !countOptions.includes(value)
    if (isCustomCount.value) customCount.value = value
  }
)

const countHint = computed(() => `${props.count} 条评论`)

function onPresetCount(option: number) {
  isCustomCount.value = false
  emit('update:count', option)
}

function onCustomCountInput(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return
  const next = Math.max(1, Math.min(1500, Math.floor(n)))
  customCount.value = next
  emit('update:count', next)
}

function enableCustomCount() {
  isCustomCount.value = true
  emit('update:count', customCount.value)
}
</script>

<template>
  <section class="glass-card">
    <h3 class="card-title">生成设置</h3>

    <div class="settings-grid">
      <div class="setting-group">
        <label class="setting-label">生成数量</label>
        <div class="segmented-control">
          <button
            v-for="option in countOptions"
            :key="option"
            :class="{ active: !isCustomCount && props.count === option }"
            @click="onPresetCount(option)"
          >
            {{ option }}
          </button>
          <button :class="{ active: isCustomCount }" @click="enableCustomCount">
            自定义
          </button>
        </div>

        <div v-if="isCustomCount" class="custom-count-row">
          <input
            type="number"
            min="1"
            max="1500"
            :value="customCount"
            @input="onCustomCountInput(($event.target as HTMLInputElement).value)"
          >
          <span>允许范围 1 ~ 1500</span>
        </div>
      </div>

      <div class="setting-group">
        <label class="setting-label">模型</label>
        <select
          class="model-select"
          :value="props.model"
          @change="emit('update:model', ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="option in MODEL_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <p class="model-hint">可在页面切换不同模型，刷新后会记住上次选择</p>
      </div>

    </div>

    <div class="options-row">
      <div class="thinking-toggle">
        <span class="setting-label">思考模式</span>
        <div class="thinking-toggle-main">
          <button
            type="button"
            class="thinking-button"
            :class="{ active: props.enableThinking, disabled: !props.thinkingSupported }"
            :disabled="!props.thinkingSupported"
            @click="emit('update:enableThinking', !props.enableThinking)"
          >
            {{ props.thinkingSupported ? (props.enableThinking ? '已开启' : '点击开启') : '当前模型不支持' }}
          </button>
          <span class="thinking-hint">仅 qwen3.5-plus / qwen3.6-plus 支持</span>
        </div>
      </div>

      <label class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="props.dedupe"
          @change="emit('update:dedupe', ($event.target as HTMLInputElement).checked)"
        >
        <span class="checkbox-custom">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="checkbox-label">自动去重</span>
      </label>

      <label class="checkbox-wrapper">
        <input
          type="checkbox"
          :checked="props.cleanEmpty"
          @change="emit('update:cleanEmpty', ($event.target as HTMLInputElement).checked)"
        >
        <span class="checkbox-custom">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="checkbox-label">清理空行</span>
      </label>

    </div>

    <div class="action-section">
      <button
        class="btn-generate"
        :disabled="props.loading"
        @click="emit('generate')"
      >
        <svg v-if="props.loading" class="icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M21 3v9h-9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ props.loading ? '生成中...' : '开始生成' }}</span>
        <span v-if="!props.loading" class="btn-hint">{{ countHint }}</span>
      </button>

      <p class="privacy-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        视频内容仅用于生成评论，不会被保存或用于其他用途。
      </p>
    </div>
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

.card-title {
  font-family: 'Poppins', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: #164E63;
  margin: 0 0 20px 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 20px;
}

@media (max-width: 640px) {
  .settings-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-label {
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #64748B;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.segmented-control {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #F1F5F9;
  border-radius: 10px;
  width: fit-content;
}

.segmented-control button {
  padding: 8px 16px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #64748B;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms ease;
}

.segmented-control button:hover {
  color: #164E63;
}

.segmented-control button.active {
  background: white;
  color: #0891B2;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.custom-count-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #64748B;
  font-size: 12px;
}

.custom-count-row input {
  width: 100px;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 14px;
  color: #164E63;
  background: white;
}

.model-select {
  width: 100%;
  max-width: 280px;
  border: 1px solid #CBD5E1;
  border-radius: 10px;
  padding: 10px 12px;
  background: white;
  color: #164E63;
  font-size: 14px;
  outline: none;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.model-select:focus {
  border-color: #0891B2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.12);
}

.model-hint {
  color: #64748B;
  font-size: 12px;
  line-height: 1.4;
}

.format-toggle {
  display: flex;
  gap: 8px;
}

.format-toggle button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #64748B;
  background: #F1F5F9;
  border: 2px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 200ms ease;
}

.format-toggle button svg {
  width: 18px;
  height: 18px;
}

.format-toggle button:hover {
  background: #E2E8F0;
  color: #475569;
}

.format-toggle button.active {
  background: white;
  border-color: #0891B2;
  color: #0891B2;
}

.options-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 16px 0;
  border-top: 1px solid #E2E8F0;
  border-bottom: 1px solid #E2E8F0;
  margin-bottom: 20px;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.thinking-toggle-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thinking-button {
  border: 1px solid #CBD5E1;
  border-radius: 999px;
  padding: 6px 14px;
  color: #475569;
  background: #F8FAFC;
  cursor: pointer;
  transition: all 200ms ease;
}

.thinking-button:hover {
  border-color: #0891B2;
}

.thinking-button.active {
  color: white;
  background: #0891B2;
  border-color: #0891B2;
}

.thinking-button.disabled {
  cursor: not-allowed;
  color: #94A3B8;
  background: #F1F5F9;
  border-color: #E2E8F0;
}

.thinking-hint {
  color: #64748B;
  font-size: 12px;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  color: #374151;
}

.segmented-control button,
.format-toggle button {
  cursor: pointer;
}

.checkbox-wrapper input {
  display: none;
}

.checkbox-custom {
  width: 20px;
  height: 20px;
  border: 2px solid #CBD5E1;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 200ms ease;
}

.checkbox-custom svg {
  width: 14px;
  height: 14px;
  color: white;
  opacity: 0;
  transition: opacity 200ms ease;
}

.checkbox-wrapper input:checked + .checkbox-custom {
  background: #0891B2;
  border-color: #0891B2;
}

.checkbox-wrapper input:checked + .checkbox-custom svg {
  opacity: 1;
}

.action-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.btn-generate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 14px 24px;
  background: linear-gradient(135deg, #0891B2 0%, #2563EB 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-family: 'Poppins', sans-serif;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease;
  position: relative;
  overflow: hidden;
}

.btn-generate::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 500ms ease;
}

.btn-generate:hover:not(:disabled)::before {
  left: 100%;
}

.btn-generate:hover:not(:disabled) {
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3);
}

.btn-generate:active:not(:disabled) {
  opacity: 0.9;
}

.btn-generate:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-generate svg {
  width: 20px;
  height: 20px;
}

.icon-spin {
  animation: spin 1s linear infinite;
}

.btn-hint {
  margin-left: 8px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.privacy-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  color: #94A3B8;
  margin: 0;
}

.privacy-note svg {
  width: 14px;
  height: 14px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
