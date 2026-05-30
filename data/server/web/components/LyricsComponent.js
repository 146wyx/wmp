import { ref, computed, watch, nextTick } from '../js/vue.esm-browser.js'

export default {
  name: 'LyricsComponent',
  
  props: {
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
  },
  
  emits: ['seek'],
  
  setup(props, { emit }) {
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
    
    // 返回值
    return {
      // Refs
      lyricsContainer,
      
      // Computed
      hasLyrics,
      
      // Methods
      handleLyricClick,
      calculateOpacity,
      calculateTransform
    }
  },
  
  template: `
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
  `
}
