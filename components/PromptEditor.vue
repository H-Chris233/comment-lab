<script setup lang="ts">
const props = defineProps<{
  basePrompt: string
  extraPrompt: string
}>()

const emit = defineEmits<{
  'update:basePrompt': [string]
  'update:extraPrompt': [string]
}>()
</script>

<template>
  <section class="card">
    <h2>2) 提示词</h2>
    <div class="stack">
      <label>默认提示词模板</label>
      <textarea
        rows="5"
        :value="props.basePrompt"
        placeholder="[系统默认提示词占位，由运营自行填写]"
        @input="emit('update:basePrompt', ($event.target as HTMLTextAreaElement).value)"
      />

      <label>附加要求</label>
      <textarea
        rows="4"
        :value="props.extraPrompt"
        placeholder="[用户附加要求占位]"
        @input="emit('update:extraPrompt', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.stack { display: grid; gap: 8px; }
textarea { padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
label { font-weight: 600; }
</style>
