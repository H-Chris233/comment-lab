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
  <section class="glass-card">
    <h3 class="card-title">选择输入方式</h3>

    <div class="tab-group">
      <button
        :class="{ active: props.mode === 'link' }"
        class="tab-btn"
        @click="emit('update:mode', 'link')"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>抖音链接</span>
      </button>
      <button
        :class="{ active: props.mode === 'upload' }"
        class="tab-btn"
        @click="emit('update:mode', 'upload')"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="17 8 12 3 7 8" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="12" y1="3" x2="12" y2="15" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>上传视频</span>
      </button>
    </div>

    <div v-if="props.mode === 'link'" class="input-group">
      <div class="input-wrapper">
        <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <input
          :value="props.url"
          type="text"
          placeholder="https://v.douyin.com/xxxx/"
          @input="emit('update:url', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <button
        class="btn btn-primary"
        :disabled="props.loading || !props.url"
        @click="emit('parse-link')"
      >
        <svg v-if="props.loading" class="icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ props.loading ? '解析中...' : '解析链接' }}</span>
      </button>
      <p v-if="props.parseStatus" class="status" :class="{ error: props.parseStatus.includes('失败') || props.parseStatus.includes('请先') }">
        {{ props.parseStatus }}
      </p>
    </div>

    <div v-else class="input-group">
      <div class="file-upload" :class="{ 'has-file': props.fileName }">
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          @change="onFileChange"
        >
        <div class="upload-placeholder">
          <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="17 8 12 3 7 8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="3" x2="12" y2="15" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p class="upload-text">点击或拖拽上传视频</p>
          <p class="upload-hint">支持 mp4/mov/webm，最大 {{ props.maxSizeMb || 100 }}MB</p>
        </div>
      </div>
      <div v-if="props.fileName" class="file-info">
        <div class="file-meta">
          <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="file-details">
            <p class="file-name">{{ props.fileName }}</p>
            <p class="file-specs">{{ props.fileSize }} · {{ props.fileType }}</p>
          </div>
        </div>
        <button class="btn-icon" @click="emit('update:file', null)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
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

.tab-group {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  padding: 4px;
  background: #F1F5F9;
  border-radius: 12px;
  width: fit-content;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #64748B;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 200ms ease;
}

.tab-btn:hover {
  color: #164E63;
}

.tab-btn.active {
  background: white;
  color: #0891B2;
  box-shadow: 0 2px 8px rgba(8, 145, 178, 0.15);
}

.icon {
  width: 18px;
  height: 18px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  width: 20px;
  height: 20px;
  color: #94A3B8;
  pointer-events: none;
}

input[type="text"] {
  width: 100%;
  padding: 12px 12px 12px 44px;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  font-family: 'Open Sans', sans-serif;
  font-size: 15px;
  color: #164E63;
  background: white;
  transition: all 200ms ease;
}

input[type="text"]::placeholder {
  color: #94A3B8;
}

input[type="text"]:hover {
  border-color: #CBD5E1;
}

input[type="text"]:focus {
  outline: none;
  border-color: #0891B2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.1);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all 200ms ease;
  width: fit-content;
}

.btn-primary {
  background: linear-gradient(135deg, #0891B2 0%, #06B6D4 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8, 145, 178, 0.3);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-spin {
  width: 18px;
  height: 18px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  color: #22C55E;
}

.status.error {
  color: #EF4444;
}

.file-upload {
  position: relative;
  border: 2px dashed #CBD5E1;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  transition: all 200ms ease;
}

.file-upload:hover {
  border-color: #0891B2;
  background: rgba(8, 145, 178, 0.02);
}

.file-upload.has-file {
  border-style: solid;
  border-color: #22C55E;
  background: rgba(34, 197, 94, 0.05);
}

.file-upload input[type="file"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.upload-icon {
  width: 48px;
  height: 48px;
  color: #94A3B8;
  margin-bottom: 12px;
}

.upload-text {
  font-family: 'Open Sans', sans-serif;
  font-size: 15px;
  font-weight: 500;
  color: #475569;
  margin: 0 0 4px 0;
}

.upload-hint {
  font-family: 'Open Sans', sans-serif;
  font-size: 13px;
  color: #94A3B8;
  margin: 0;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: white;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
}

.file-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-icon {
  width: 40px;
  height: 40px;
  color: #0891B2;
}

.file-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #164E63;
  margin: 0;
}

.file-specs {
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  color: #64748B;
  margin: 0;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: #F1F5F9;
  color: #64748B;
  cursor: pointer;
  transition: all 200ms ease;
}

.btn-icon svg {
  width: 16px;
  height: 16px;
}

.btn-icon:hover {
  background: #FEE2E2;
  color: #EF4444;
}

@media (max-width: 640px) {
  .glass-card {
    padding: 20px;
  }

  .card-title {
    font-size: 16px;
  }

  .tab-btn {
    padding: 8px 12px;
    font-size: 13px;
  }

  .tab-btn span {
    display: none;
  }

  .file-upload {
    padding: 24px;
  }
}
</style>