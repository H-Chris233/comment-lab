<script setup lang="ts">
const props = defineProps<{
  count: number
  loading: boolean
  beforeCount: number
  afterCount: number
  copiedHint?: string
}>()

const emit = defineEmits<{
  copy: []
  txt: []
  csv: []
  regenerate: []
}>()
</script>

<template>
  <div class="toolbar">
    <div>
      <strong>已生成 {{ props.count }} 条</strong>
      <p class="muted">原始 {{ props.beforeCount }} 条 / 清洗后 {{ props.afterCount }} 条</p>
      <p v-if="props.copiedHint" class="hint">{{ props.copiedHint }}</p>
    </div>
    <div class="row">
      <button :disabled="props.loading || !props.count" @click="emit('copy')">复制全部</button>
      <button :disabled="props.loading || !props.count" @click="emit('txt')">导出 TXT</button>
      <button :disabled="props.loading || !props.count" @click="emit('csv')">导出 CSV</button>
      <button :disabled="props.loading" @click="emit('regenerate')">重新生成</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
.muted { margin: 2px 0 0; color: #666; font-size: 12px; }
.hint { margin: 2px 0 0; color: #0a7a2f; font-size: 12px; }
</style>
