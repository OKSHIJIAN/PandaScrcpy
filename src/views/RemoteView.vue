<template>
  <v-container fluid class="remote-view">
    <ViewerPanel :initial-peer-id="initialPeerId" :is-figma-embed="isFigmaEmbed" />
  </v-container>
</template>

<script setup lang="ts">
import ViewerPanel from '@/components/Remote/ViewerPanel.vue';

defineProps<{
  initialPeerId?: string;
  isFigmaEmbed?: boolean;
}>();
</script>

<style scoped>
.remote-view {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden;
  background: #000;
}

.remote-view :deep(.v-main__wrap) {
  padding: 0 !important;
}

.remote-view :deep(.v-container) {
  padding: 0 !important;
}
</style>
