<script setup lang="ts">const props = defineProps<{
  steps: string[]
  current: number
}>()
</script>

<template>
  <div class="step-indicator">
    <div v-for="(step, index) in steps" :key="index" class="step">
      <div class="step-content" :class="{ active: current === index, completed: current > index }">
        <div class="step-number">
          <svg v-if="current > index" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-else>{{ index + 1 }}</span>
        </div>
        <span class="step-label">{{ step }}</span>
      </div>
      <div v-if="index < steps.length - 1" class="step-line" :class="{ completed: current > index }" />
    </div>
  </div>
</template>

<style scoped>
.step-indicator {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 0 16px 24px;
  flex-wrap: wrap;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-content {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 50px;
  transition: all 200ms ease;
}

.step-content.active {
  background: rgba(8, 145, 178, 0.1);
}

.step-number {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #E2E8F0;
  color: #64748B;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 200ms ease;
}

.step-content.active .step-number {
  background: #0891B2;
  color: white;
}

.step-content.completed .step-number {
  background: #22C55E;
  color: white;
}

.step-number svg {
  width: 16px;
  height: 16px;
}

.step-label {
  font-family: 'Open Sans', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: #64748B;
  transition: color 200ms ease;
}

.step-content.active .step-label {
  color: #164E63;
  font-weight: 600;
}

.step-content.completed .step-label {
  color: #22C55E;
}

.step-line {
  width: 24px;
  height: 2px;
  background: #E2E8F0;
  transition: background 200ms ease;
}

.step-line.completed {
  background: #22C55E;
}

@media (max-width: 640px) {
  .step-indicator {
    gap: 4px;
    padding: 0 8px 16px;
  }

  .step-content {
    padding: 6px 10px;
  }

  .step-label {
    font-size: 12px;
  }

  .step-line {
    width: 12px;
  }
}
</style>
