<template>
  <div class="lyrics-panel" v-if="hasLyrics">
    <div 
      ref="lyricsContainer" 
      class="lyrics-container"
    >
      <div
        v-for="(line, index) in lyrics"
        :key="index"
        class="lyric-line"
        :class="{
          'active': index === currentLyricIndex,
          'bilingual': line.primary && line.secondary && line.secondary !== '',
          'bilingual-vertical': line.primary && line.secondary && line.secondary !== '' && bilingualMode === 'vertical',
          'bilingual-horizontal': line.primary && line.secondary && line.secondary !== '' && bilingualMode === 'horizontal',
          'bilingual-overlay': line.primary && line.secondary && line.secondary !== '' && bilingualMode === 'overlay',
          'upcoming': index > currentLyricIndex && index <= currentLyricIndex + 2,
          'past': index < currentLyricIndex && index >= currentLyricIndex - 2
        }"
        :style="{
          opacity: calculateOpacity(index),
          transform: calculateTransform(index)
        }"
        @click="handleLyricClick(line.time)"
      >
        <!-- 双语歌词：根据模式显示 -->
        <template v-if="line.primary && line.secondary && line.secondary !== ''">
          <!-- 垂直模式 -->
          <template v-if="bilingualMode === 'vertical'">
            <span class="lyric-primary">{{ line.primary }}</span>
            <span class="lyric-secondary">{{ line.secondary }}</span>
          </template>
          <!-- 水平模式 -->
          <template v-else-if="bilingualMode === 'horizontal'">
            <span class="lyric-primary">{{ line.primary }}</span>
            <span class="lyric-separator">|</span>
            <span class="lyric-secondary">{{ line.secondary }}</span>
          </template>
          <!-- 叠加模式 -->
          <template v-else-if="bilingualMode === 'overlay'">
            <div class="lyric-overlay">
              <span class="lyric-primary">{{ line.primary }}</span>
              <span class="lyric-secondary">{{ line.secondary }}</span>
            </div>
          </template>
        </template>
        <!-- 单语歌词 -->
        <template v-else>
          {{ line.text }}
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

// Props
const props = defineProps({
  lyrics: {
    type: Array,
    default: () => []
  },
  currentLyricIndex: {
    type: Number,
    default: -1
  },
  currentTime: {
    type: Number,
    default: 0
  },
  bilingualMode: {
    type: String,
    default: 'vertical',
    validator: (value) => ['vertical', 'horizontal', 'overlay'].includes(value)
  }
})

// Emits
const emit = defineEmits(['seek'])

// Refs
const lyricsContainer = ref(null)

// Computed
const hasLyrics = computed(() => {
  return props.lyrics && props.lyrics.length > 0
})

// Methods
function handleLyricClick(time) {
  emit('seek', time)
}

function calculateOpacity(index) {
  if (props.currentLyricIndex === -1) return 0.35
  
  const distance = Math.abs(index - props.currentLyricIndex)
  
  if (distance === 0) return 1
  if (distance === 1) return 0.7
  if (distance === 2) return 0.5
  if (distance === 3) return 0.35
  
  return 0.2
}

function calculateTransform(index) {
  if (props.currentLyricIndex === -1) return 'scale(1)'
  
  const distance = Math.abs(index - props.currentLyricIndex)
  
  if (distance === 0) return 'scale(1.05)'
  if (distance === 1) return 'scale(1.02)'
  if (distance === 2) return 'scale(1)'
  
  return 'scale(0.95)'
}

function updateScrollPosition() {
  if (!lyricsContainer.value || props.currentLyricIndex === -1) return
  
  const activeLine = lyricsContainer.value.children[props.currentLyricIndex]
  if (!activeLine) return
  
  const container = lyricsContainer.value
  const containerHeight = container.clientHeight
  const lineHeight = activeLine.clientHeight
  const lineOffsetTop = activeLine.offsetTop
  
  // 计算需要滚动的距离：让当前行居中
  const scrollOffset = lineOffsetTop - containerHeight / 2 + lineHeight / 2
  
  // 使用 requestAnimationFrame 优化动画性能
  requestAnimationFrame(() => {
    // 应用平滑滚动
    container.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    container.style.transform = `translateY(calc(-50% - ${scrollOffset}px))`
    
    // 清除过渡效果，避免后续操作受影响
    setTimeout(() => {
      if (container) {
        container.style.transition = ''
      }
    }, 400)
  })
}

// Watchers
watch(() => props.currentLyricIndex, () => {
  nextTick(() => {
    updateScrollPosition()
  })
})

watch(() => props.lyrics, () => {
  nextTick(() => {
    updateScrollPosition()
  })
}, { deep: true })

watch(() => props.bilingualMode, () => {
  nextTick(() => {
    updateScrollPosition()
  })
})
</script>

<style scoped>
/* 歌词面板 */
.lyrics-panel {
  width: 100%;
  height: 200px;
  overflow: hidden;
  border-radius: 12px;
  margin: 0 0 15px;
  text-align: center;
  position: relative;
  background: rgba(0, 0, 0, 0.2);
}

/* 歌词容器 */
.lyrics-container {
  position: absolute;
  width: 100%;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* 动画关键帧 */
@keyframes fadeInUp {
  from {
    opacity: 0.2;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 0.7;
    transform: translateY(0) scale(1);
  }
}

@keyframes fadeOutDown {
  from {
    opacity: 1;
    transform: translateY(0) scale(1.05);
  }
  to {
    opacity: 0.35;
    transform: translateY(-20px) scale(0.95);
  }
}

/* 歌词行 */
.lyric-line {
  padding: 8px 20px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
  text-align: center;
  transition: all 0.4s ease;
  cursor: pointer;
  user-select: none;
  will-change: opacity, transform;
}

.lyric-line:hover {
  opacity: 0.8 !important;
  transform: scale(1.03) !important;
}

/* 即将到来和已过去的歌词 */
.lyric-line.upcoming {
  animation: fadeInUp 0.6s ease-out;
}

.lyric-line.past {
  animation: fadeOutDown 0.6s ease-out;
}

/* 高亮歌词 */
.lyric-line.active {
  color: var(--text-secondary);
  font-size: 18px;
  font-weight: 600;
  opacity: 1;
  transform: scale(1.05);
  text-shadow: 0 0 20px rgba(255, 107, 107, 0.5), 0 2px 4px rgba(0,0,0,0.3);
  min-height: 52px;
  line-height: 52px;
}

/* 双语歌词基础样式 */
.lyric-line.bilingual {
  line-height: normal;
  display: flex;
  justify-content: center;
  align-items: center;
  user-select: none;
}

/* 垂直模式 */
.lyric-line.bilingual-vertical {
  min-height: 60px;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}

.lyric-line.bilingual-vertical .lyric-primary {
  font-size: 14px;
  line-height: 1.4;
  font-weight: 500;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
}

.lyric-line.bilingual-vertical .lyric-secondary {
  font-size: 12px;
  opacity: 0.5;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.6);
}

/* 水平模式 */
.lyric-line.bilingual-horizontal {
  min-height: 40px;
  flex-direction: row;
  gap: 12px;
  padding: 6px 0;
}

.lyric-line.bilingual-horizontal .lyric-primary {
  font-size: 14px;
  line-height: 1.4;
  font-weight: 500;
}

.lyric-line.bilingual-horizontal .lyric-separator {
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
}

.lyric-line.bilingual-horizontal .lyric-secondary {
  font-size: 12px;
  opacity: 0.7;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.7);
}

/* 叠加模式 */
.lyric-line.bilingual-overlay {
  min-height: 60px;
  position: relative;
  padding: 6px 0;
}

.lyric-line.bilingual-overlay .lyric-overlay {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.lyric-line.bilingual-overlay .lyric-primary {
  font-size: 16px;
  line-height: 1.4;
  font-weight: 600;
  position: relative;
  z-index: 2;
}

.lyric-line.bilingual-overlay .lyric-secondary {
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.6);
  position: relative;
  z-index: 1;
  margin-top: -2px;
}

/* 高亮状态的双语歌词 */
.lyric-line.active.bilingual-vertical {
  min-height: 80px;
}

.lyric-line.active.bilingual-vertical .lyric-primary {
  font-size: 19px;
  font-weight: 700;
}

.lyric-line.active.bilingual-vertical .lyric-secondary {
  font-size: 14px;
  opacity: 0.8;
  color: rgba(255, 255, 255, 0.9);
}

.lyric-line.active.bilingual-horizontal {
  min-height: 50px;
}

.lyric-line.active.bilingual-horizontal .lyric-primary {
  font-size: 16px;
  font-weight: 700;
}

.lyric-line.active.bilingual-horizontal .lyric-secondary {
  font-size: 13px;
  opacity: 0.8;
  color: rgba(255, 255, 255, 0.9);
}

.lyric-line.active.bilingual-overlay {
  min-height: 70px;
}

.lyric-line.active.bilingual-overlay .lyric-primary {
  font-size: 20px;
  font-weight: 700;
}

.lyric-line.active.bilingual-overlay .lyric-secondary {
  font-size: 12px;
  opacity: 0.7;
  color: rgba(255, 255, 255, 0.8);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .lyrics-panel {
    height: 160px;
    margin: 0 0 10px;
  }
  
  .lyric-line {
    font-size: 12px;
    padding: 6px 15px;
    min-height: 36px;
    line-height: 36px;
  }
  
  .lyric-line.active {
    font-size: 16px;
    min-height: 44px;
    line-height: 44px;
  }
  
  /* 垂直模式 */
  .lyric-line.bilingual-vertical {
    min-height: 50px;
    gap: 2px;
    padding: 4px 0;
  }
  
  .lyric-line.bilingual-vertical .lyric-primary {
    font-size: 12px;
  }
  
  .lyric-line.bilingual-vertical .lyric-secondary {
    font-size: 10px;
  }
  
  /* 水平模式 */
  .lyric-line.bilingual-horizontal {
    min-height: 36px;
    gap: 8px;
    padding: 4px 0;
  }
  
  .lyric-line.bilingual-horizontal .lyric-primary {
    font-size: 12px;
  }
  
  .lyric-line.bilingual-horizontal .lyric-secondary {
    font-size: 10px;
  }
  
  /* 叠加模式 */
  .lyric-line.bilingual-overlay {
    min-height: 50px;
    padding: 4px 0;
  }
  
  .lyric-line.bilingual-overlay .lyric-primary {
    font-size: 14px;
  }
  
  .lyric-line.bilingual-overlay .lyric-secondary {
    font-size: 10px;
  }
  
  /* 高亮状态 */
  .lyric-line.active.bilingual-vertical {
    min-height: 65px;
  }
  
  .lyric-line.active.bilingual-vertical .lyric-primary {
    font-size: 16px;
  }
  
  .lyric-line.active.bilingual-vertical .lyric-secondary {
    font-size: 12px;
  }
  
  .lyric-line.active.bilingual-horizontal {
    min-height: 44px;
  }
  
  .lyric-line.active.bilingual-horizontal .lyric-primary {
    font-size: 14px;
  }
  
  .lyric-line.active.bilingual-horizontal .lyric-secondary {
    font-size: 12px;
  }
  
  .lyric-line.active.bilingual-overlay {
    min-height: 60px;
  }
  
  .lyric-line.active.bilingual-overlay .lyric-primary {
    font-size: 18px;
  }
  
  .lyric-line.active.bilingual-overlay .lyric-secondary {
    font-size: 11px;
  }
}

/* 大屏幕响应式设计 */
@media (min-width: 1200px) {
  .lyrics-panel {
    height: 220px;
  }
  
  .lyric-line {
    font-size: 16px;
    padding: 10px 25px;
  }
  
  .lyric-line.active {
    font-size: 20px;
    min-height: 56px;
    line-height: 56px;
  }
  
  /* 垂直模式 */
  .lyric-line.bilingual-vertical {
    min-height: 70px;
    gap: 6px;
  }
  
  .lyric-line.bilingual-vertical .lyric-primary {
    font-size: 16px;
  }
  
  .lyric-line.bilingual-vertical .lyric-secondary {
    font-size: 14px;
  }
  
  /* 水平模式 */
  .lyric-line.bilingual-horizontal {
    min-height: 48px;
    gap: 16px;
  }
  
  .lyric-line.bilingual-horizontal .lyric-primary {
    font-size: 16px;
  }
  
  .lyric-line.bilingual-horizontal .lyric-secondary {
    font-size: 14px;
  }
  
  /* 叠加模式 */
  .lyric-line.bilingual-overlay {
    min-height: 70px;
  }
  
  .lyric-line.bilingual-overlay .lyric-primary {
    font-size: 18px;
  }
  
  .lyric-line.bilingual-overlay .lyric-secondary {
    font-size: 12px;
  }
  
  /* 高亮状态 */
  .lyric-line.active.bilingual-vertical {
    min-height: 90px;
  }
  
  .lyric-line.active.bilingual-vertical .lyric-primary {
    font-size: 22px;
  }
  
  .lyric-line.active.bilingual-vertical .lyric-secondary {
    font-size: 16px;
  }
  
  .lyric-line.active.bilingual-horizontal {
    min-height: 56px;
  }
  
  .lyric-line.active.bilingual-horizontal .lyric-primary {
    font-size: 18px;
  }
  
  .lyric-line.active.bilingual-horizontal .lyric-secondary {
    font-size: 16px;
  }
  
  .lyric-line.active.bilingual-overlay {
    min-height: 80px;
  }
  
  .lyric-line.active.bilingual-overlay .lyric-primary {
    font-size: 24px;
  }
  
  .lyric-line.active.bilingual-overlay .lyric-secondary {
    font-size: 14px;
  }
}
</style>