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
</script>

<template>
  <section class="card">
    <h2>3) 参数与生成</h2>
    <div class="row">
      <label>数量</label>
      <select :value="props.count" @change="emit('update:count', Number(($event.target as HTMLSelectElement).value))">
        <option :value="100">100</option>
        <option :value="200">200</option>
        <option :value="300">300</option>
        <option :value="500">500</option>
      </select>

      <label>输出</label>
      <select
        :value="props.outputFormat"
        @change="emit('update:outputFormat', (($event.target as HTMLSelectElement).value as 'text' | 'json'))"
      >
        <option value="text">纯文本</option>
        <option value="json">JSON 数组</option>
      </select>
    </div>

    <div class="row">
      <label><input type="checkbox" :checked="props.dedupe" @change="emit('update:dedupe', ($event.target as HTMLInputElement).checked)"> 自动去重</label>
      <label><input type="checkbox" :checked="props.cleanEmpty" @change="emit('update:cleanEmpty', ($event.target as HTMLInputElement).checked)"> 空行清理</label>
    </div>

    <button :disabled="props.loading" @click="emit('generate')">
      {{ props.loading ? '生成中...' : '生成评论' }}
    </button>
  </section>
</template>

<style scoped>
.card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
select, button { padding: 8px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
</style>
