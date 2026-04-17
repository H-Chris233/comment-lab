<script setup lang="ts">
const props = defineProps<{ comments: string[] }>()

const emit = defineEmits<{
  copyOne: [string]
  deleteOne: [number]
}>()
</script>

<template>
  <ul class="list">
    <li v-for="(item, index) in props.comments" :key="`${index}-${item}`" class="item">
      <span>{{ item }}</span>
      <div class="row">
        <button @click="emit('copyOne', item)">复制</button>
        <button @click="emit('deleteOne', index)">删除</button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.item { border: 1px solid #eee; border-radius: 8px; padding: 10px; display: flex; justify-content: space-between; gap: 8px; }
.row { display: flex; gap: 6px; }
button { padding: 4px 8px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
</style>
