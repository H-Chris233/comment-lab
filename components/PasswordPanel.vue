<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  mode: 'setup' | 'login' | 'change'
  loading: boolean
  error?: string
  compact?: boolean
  embedded?: boolean
}>()

const emit = defineEmits<{
  submit: [{ password: string; confirmPassword: string }]
}>()

const password = ref('')
const confirmPassword = ref('')
const localError = ref('')

const isLogin = computed(() => props.mode === 'login')
const showConfirm = computed(() => !isLogin.value)
const passwordAutoComplete = computed(() => (isLogin.value ? 'current-password' : 'new-password'))
const title = computed(() => {
  if (props.mode === 'setup') return '首次访问请设置密码'
  if (props.mode === 'change') return '修改密码'
  return '请输入密码'
})
const description = computed(() => {
  if (props.mode === 'setup') return '密码会保存到服务端，之后每次打开页面都需要重新输入。'
  if (props.mode === 'change') return '修改后当前会话继续有效，关闭浏览器后下次会使用新密码。'
  return '输入密码后即可进入主页面。'
})
const submitLabel = computed(() => {
  if (props.mode === 'setup') return '设置并进入'
  if (props.mode === 'change') return '确认修改'
  return '进入'
})
const displayError = computed(() => localError.value || props.error || '')

function resetForm() {
  password.value = ''
  confirmPassword.value = ''
  localError.value = ''
}

function handleSubmit() {
  localError.value = ''
  const nextPassword = password.value.trim()

  if (nextPassword.length < 4) {
    localError.value = '密码至少 4 位'
    return
  }

  if (showConfirm.value && nextPassword !== confirmPassword.value.trim()) {
    localError.value = '两次输入的密码不一致'
    return
  }

  emit('submit', {
    password: nextPassword,
    confirmPassword: confirmPassword.value.trim()
  })
}

watch(
  () => props.mode,
  () => {
    resetForm()
  }
)

defineExpose({ resetForm })
</script>

<template>
  <section class="password-card" :class="{ compact: props.compact, embedded: props.embedded }">
    <div class="card-header">
      <div>
        <h3 class="card-title">{{ title }}</h3>
        <p class="card-desc">{{ description }}</p>
      </div>
      <span class="badge">{{ props.mode === 'change' ? '当前会话可用' : '单密码' }}</span>
    </div>

    <form class="password-form" @submit.prevent="handleSubmit">
      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="passwordAutoComplete"
          placeholder="请输入密码"
        >
      </label>

      <label v-if="showConfirm" class="field">
        <span class="field-label">确认密码</span>
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="再输入一次"
        >
      </label>

      <Transition name="fade">
        <p v-if="displayError" class="error-text">{{ displayError }}</p>
      </Transition>

      <button class="btn-confirm" type="submit" :disabled="props.loading">
        <svg v-if="props.loading" class="icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ props.loading ? '处理中...' : submitLabel }}</span>
      </button>
    </form>
  </section>
</template>

<style scoped>
.password-card {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 18px;
  box-shadow: 0 10px 30px rgba(8, 145, 178, 0.12);
  padding: 28px;
}

.password-card.compact {
  padding: 20px;
}

.password-card.embedded {
  background: transparent;
  backdrop-filter: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.card-title {
  margin: 0;
  font-family: 'Poppins', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #164E63;
}

.card-desc {
  margin: 8px 0 0;
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #64748B;
}

.badge {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  background: #E0F2FE;
  color: #0369A1;
  font-size: 12px;
  font-weight: 600;
}

.password-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #CBD5E1;
  border-radius: 12px;
  padding: 12px 14px;
  background: white;
  color: #0F172A;
  font-size: 15px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

input:focus {
  outline: none;
  border-color: #0891B2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.12);
}

.error-text {
  margin: 0;
  color: #DC2626;
  font-size: 13px;
}

.btn-confirm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  align-self: flex-start;
  min-width: 140px;
  padding: 12px 18px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #0891B2 0%, #22D3EE 100%);
  color: white;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(8, 145, 178, 0.18);
}

.btn-confirm:disabled {
  opacity: 0.7;
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

@media (max-width: 640px) {
  .glass-card {
    padding: 20px;
  }

  .card-title {
    font-size: 18px;
  }
}
</style>
