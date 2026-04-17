<script setup lang="ts">
// App Header with Logo
</script>

<template>
  <header class="app-header">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 10H16M8 14H12M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.5132 10.1786 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="logo-text">Comment Lab</span>
    </div>
    <p class="tagline">AI 智能评论生成器</p>
  </header>
</template>

<style scoped>
.app-header {
  text-align: center;
  padding: 48px 20px 32px;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.logo-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #0891B2 0%, #22D3EE 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.logo-icon svg {
  width: 24px;
  height: 24px;
}

.logo-text {
  font-family: 'Poppins', sans-serif;
  font-size: 28px;
  font-weight: 700;
  color: #164E63;
  letter-spacing: -0.5px;
}

.tagline {
  font-family: 'Open Sans', sans-serif;
  font-size: 16px;
  color: #64748B;
  margin: 0;
}

@media (max-width: 640px) {
  .app-header {
    padding: 32px 16px 24px;
  }

  .logo-text {
    font-size: 24px;
  }

  .tagline {
    font-size: 14px;
  }
}
</style>
