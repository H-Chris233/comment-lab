<script setup lang="ts">
const props = defineProps<{
  count: number
  outputFormat: 'text' | 'json'
  dedupe: boolean
  cleanEmpty: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  'update:count': [number]
  'update:outputFormat': ['text' | 'json']
  'update:dedupe': [boolean]
  'update:cleanEmpty': [boolean]
  generate: []
}>()

const countOptions = [100, 200, 300, 500]
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
            :class="{ active: props.count === option }"
            @click="emit('update:count', option)"
          >
            {{ option }}
          </button>
        </div>
      </div>

      <div class="setting-group">
        <label class="setting-label">输出格式</label>
        <div class="format-toggle">
          <button
            :class="{ active: props.outputFormat === 'text' }"
            @click="emit('update:outputFormat', 'text')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="10 9 9 9 8 9" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>纯文本</span>
          </button>
          <button
            :class="{ active: props.outputFormat === 'json' }"
            @click="emit('update:outputFormat', 'json')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 9 7 12 4 15" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="20 9 17 12 20 15" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="9" y1="12" x2="15" y2="12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>JSON</span>
          </button>
        </div>
      </div>
    </div>

    <div class="options-row">
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
        <span v-if="!props.loading" class="btn-hint">{{ props.count }} 条评论</span>
      </button>

      <p class="privacy-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        视频内容仅用于生成评论，不会被保存或用于其他用途
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
  gap: 24px;
  padding: 16px 0;
  border-top: 1px solid #E2E8F0;
  border-bottom: 1px solid #E2E8F0;
  margin-bottom: 20px;
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
  transform: scale(0.5);
  transition: all 200ms ease;
}

.checkbox-wrapper input:checked + .checkbox-custom {
  background: #0891B2;
  border-color: #0891B2;
}

.checkbox-wrapper input:checked + .checkbox-custom svg {
  opacity: 1;
  transform: scale(1);
}

.checkbox-label {
  color: #475569;
  font-weight: 500;
}

.action-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.btn-generate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 400px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
  color: white;
  font-family: 'Poppins', sans-serif;
  font-size: 16px;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 200ms ease;
  box-shadow: 0 4px 14px rgba(34, 197, 94, 0.3);
}

.btn-generate:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(34, 197, 94, 0.4);
}

.btn-generate:active:not(:disabled) {
  transform: translateY(0);
}

.btn-generate:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-generate svg {
  width: 20px;
  height: 20px;
}

.icon-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.btn-hint {
  margin-left: auto;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}

.privacy-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  color: #94A3B8;
}

.privacy-note svg {
  width: 14px;
  height: 14px;
}

@media (max-width: 640px) {
  .glass-card {
    padding: 20px;
  }

  .card-title {
    font-size: 16px;
  }

  .segmented-control button {
    padding: 6px 12px;
    font-size: 13px;
  }

  .format-toggle button {
    flex: 1;
    justify-content: center;
  }

  .btn-generate {
    font-size: 15px;
    padding: 14px 24px;
  }
}
</style>
