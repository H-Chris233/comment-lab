<script setup lang="ts">const props = defineProps<{
  basePrompt: string
  extraPrompt: string
}>()

const emit = defineEmits<{
  'update:basePrompt': [string]
  'update:extraPrompt': [string]
}>()
</script>

<template>
  <section class="glass-card">
    <div class="card-header">
      <h3 class="card-title">配置提示词</h3>
      <span class="badge">可选</span>
    </div>

    <div class="form-group">
      <label class="label">
        <svg class="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="16" y1="13" x2="8" y2="13" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="16" y1="17" x2="8" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="10 9 9 9 8 9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        基础提示词模板
      </label>
      <textarea
        :value="props.basePrompt"
        rows="5"
        placeholder="输入用于指导 AI 生成评论的基础提示词..."
        @input="emit('update:basePrompt', ($event.target as HTMLTextAreaElement).value)"
      />
      <p class="hint">定义评论生成的基础风格和要求</p>
    </div>

    <div class="form-group">
      <label class="label">
        <svg class="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        附加要求
      </label>
      <textarea
        :value="props.extraPrompt"
        rows="3"
        placeholder="添加额外的定制化要求，如特定话题、关键词、语气风格等..."
        @input="emit('update:extraPrompt', ($event.target as HTMLTextAreaElement).value)"
      />
      <p class="hint">针对当前视频的特定要求</p>
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.card-title {
  font-family: 'Poppins', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: #164E63;
  margin: 0;
}

.badge {
  padding: 4px 10px;
  background: #F1F5F9;
  color: #64748B;
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  font-weight: 500;
  border-radius: 20px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.label-icon {
  width: 18px;
  height: 18px;
  color: #64748B;
}

textarea {
  width: 100%;
  padding: 14px;
  border: 2px solid #E2E8F0;
  border-radius: 10px;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #164E63;
  background: white;
  resize: vertical;
  transition: all 200ms ease;
  box-sizing: border-box;
}

textarea::placeholder {
  color: #94A3B8;
}

textarea:hover {
  border-color: #CBD5E1;
}

textarea:focus {
  outline: none;
  border-color: #0891B2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.1);
}

.hint {
  margin: 6px 0 0 0;
  font-family: 'Open Sans', sans-serif;
  font-size: 12px;
  color: #94A3B8;
}

@media (max-width: 640px) {
  .glass-card {
    padding: 20px;
  }

  .card-title {
    font-size: 16px;
  }

textarea {
    font-size: 16px; /* Prevent zoom on iOS */
  }
}
</style>