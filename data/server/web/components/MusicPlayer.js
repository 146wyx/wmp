/**
 * MusicPlayer - 重构后的音乐播放器组件
 * 使用新的服务架构，分离播放逻辑和UI
 */

import { initPlayerServices } from '../services/index.js'
import { PlayModes, PlayModeConfig, formatTime } from '../utils/AudioUtils.js'
import LyricsComponent from './LyricsComponent.js'
import LazyImage from './LazyImage.js'

export default {
  name: 'MusicPlayer',
  
  components: {
    LyricsComponent,
    LazyImage
  },
  
  props: {
    isLoggedIn: {
      type: Boolean,
      default: false
    },
    currentUser: {
      type: Object,
      default: null
    },
    favorites: {
      type: Array,
      default: () => []
    }
  },
  
  emits: ['open-upload', 'open-login', 'logout', 'change-password', 'add-favorite', 'remove-favorite', 'show-favorites'],
  
  setup(props, { emit }) {
    const { ref, computed, onMounted, onUnmounted, watch, nextTick } = window.Vue

    // ========== 服务引用 ==========
    let services = null
    let playerService = null
    let playlistService = null
    let historyService = null
    const store = ref(null)
    
    // ========== 本地状态 ==========
    const isInitializing = ref(true)
    const searchQuery = ref('')
    const isDragging = ref(false)
    const showUserMenu = ref(false)
    const contextMenu = ref({
      show: false,
      x: 0,
      y: 0,
      song: null
    })
    
    // ========== 计算属性 ==========

    // 从 store 获取状态 (使用 computed 保持响应式)
    const state = computed(() => store.value?.state || {})

    // 播放列表
    const playlist = computed(() => store.value?.state?.playlist || [])

    // 当前歌曲
    const currentSong = computed(() => store.value?.state?.currentSong)

    // 是否播放中
    const isPlaying = computed(() => store.value?.state?.isPlaying)

    // 是否加载中
    const isLoading = computed(() => store.value?.state?.isLoading)

    // 当前时间
    const currentTime = computed(() => store.value?.state?.currentTime || 0)

    // 总时长
    const duration = computed(() => store.value?.state?.duration || 0)

    // 音量
    const volume = computed(() => store.value?.state?.volume || 0.7)

    // 是否静音
    const isMuted = computed(() => store.value?.state?.isMuted)

    // 播放模式
    const playMode = computed(() => store.value?.state?.playMode || PlayModes.SEQUENCE)

    // 是否显示播放列表
    const showPlaylist = computed(() => store.value?.state?.showPlaylist)

    // 歌词
    const lyrics = computed(() => store.value?.state?.lyrics || [])

    // 当前歌词索引
    const currentLyricIndex = computed(() => store.value?.state?.currentLyricIndex || -1)

    // 自动播放被阻止
    const autoPlayBlocked = computed(() => store.value?.state?.autoPlayBlocked)
    
    // 进度百分比
    const progressPercent = computed(() => {
      if (!duration.value || duration.value === 0) return 0
      return (currentTime.value / duration.value) * 100
    })
    
    // 过滤后的播放列表
    const filteredPlaylist = computed(() => {
      if (!searchQuery.value.trim()) return playlist.value
      return playlistService?.search(searchQuery.value) || playlist.value
    })
    
    // 播放模式配置
    const playModeConfig = computed(() => {
      return PlayModeConfig[playMode.value] || PlayModeConfig[PlayModes.SEQUENCE]
    })
    
    // ========== 方法 ==========
    
    /**
     * 初始化播放器
     */
    async function initPlayer() {
      try {
        isInitializing.value = true
        console.log('[MusicPlayer] Starting initialization...')
        
        // 初始化所有服务
        console.log('[MusicPlayer] Initializing services...')
        services = await initPlayerServices()
        playerService = services.playerService
        playlistService = services.playlistService
        historyService = services.historyService
        store.value = services.store
        console.log('[MusicPlayer] Services initialized')
        
        // 加载播放列表
        console.log('[MusicPlayer] Loading playlist...')
        await playlistService.loadPlaylist()
        console.log('[MusicPlayer] Playlist loaded, count:', store.value?.state?.playlist?.length || 0)
        
        console.log('[MusicPlayer] Initialized successfully')
      } catch (error) {
        console.error('[MusicPlayer] Initialization failed:', error)
      } finally {
        isInitializing.value = false
      }
    }
    
    /**
     * 播放歌曲
     */
    async function playSong(song) {
      if (!song || !playerService) return
      await playerService.playSong(song)
    }
    
    /**
     * 切换播放/暂停
     */
    async function togglePlay() {
      if (!playerService) return
      await playerService.toggle()
    }
    
    /**
     * 上一首
     */
    async function prevSong() {
      if (!playerService) return
      await playerService.previous()
    }
    
    /**
     * 下一首
     */
    async function nextSong() {
      if (!playerService) return
      await playerService.next()
    }
    
    /**
     * 切换播放模式
     */
    function togglePlayMode() {
      if (!playerService) return
      playerService.togglePlayMode()
    }
    
    /**
     * 设置音量
     */
    function setVolume(event) {
      if (!playerService) return
      
      const volumeBar = event.currentTarget
      const rect = volumeBar.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      
      playerService.setVolume(percent)
    }
    
    /**
     * 切换静音
     */
    function toggleMute() {
      if (!playerService) return
      playerService.toggleMute()
    }
    
    /**
     * 跳转到指定时间
     */
    function seek(time) {
      if (!playerService) return
      
      // 如果是事件对象，则计算时间值
      if (typeof time === 'object' && time.currentTarget) {
        const progressBar = time.currentTarget
        const rect = progressBar.getBoundingClientRect()
        const percent = Math.max(0, Math.min(1, (time.clientX - rect.left) / rect.width))
        time = percent * duration.value
      }
      
      // 确保时间值是有限数值
      if (!isFinite(time)) return
      
      playerService.seek(time)
    }
    
    /**
     * 开始拖动进度条
     */
    function startDrag(event) {
      isDragging.value = true
      seek(event)
      
      document.addEventListener('mousemove', onDrag)
      document.addEventListener('mouseup', stopDrag)
    }
    
    /**
     * 拖动中
     */
    function onDrag(event) {
      if (!isDragging.value) return
      
      const progressBar = document.querySelector('.progress-bar')
      if (!progressBar) return
      
      const rect = progressBar.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      
      if (store) {
        store.mutations.setCurrentTime(percent * duration.value)
      }
    }
    
    /**
     * 停止拖动
     */
    function stopDrag(event) {
      if (isDragging.value) {
        const progressBar = document.querySelector('.progress-bar')
        if (progressBar) {
          const rect = progressBar.getBoundingClientRect()
          const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
          playerService?.seek(percent * duration.value)
        }
      }
      
      isDragging.value = false
      document.removeEventListener('mousemove', onDrag)
      document.removeEventListener('mouseup', stopDrag)
    }
    
    /**
     * 刷新播放列表
     */
    async function refreshPlaylist() {
      if (!playlistService) return
      await playlistService.refresh()
    }
    
    /**
     * 加载音乐列表（供父组件调用）
     */
    async function loadMusicList() {
      if (!playlistService) {
        console.warn('[MusicPlayer] PlaylistService not initialized')
        return
      }
      await playlistService.refresh()
      console.log('[MusicPlayer] Music list reloaded')
    }
    
    /**
     * 播放收藏歌曲
     */
    async function playFavoriteSong(favoriteSong) {
      if (!favoriteSong || !playlistService) return
      
      // 在播放列表中查找
      const song = playlistService.getSongByFilename(favoriteSong.filename)
      
      if (song) {
        await playSong(song)
      } else {
        // 如果不在播放列表，创建临时歌曲对象
        const newSong = {
          id: favoriteSong.id || Date.now(),
          title: favoriteSong.title,
          artist: favoriteSong.artist,
          album: favoriteSong.album || '',
          cover: favoriteSong.coverUrl || playerService?.getDefaultCover(),
          url: favoriteSong.url,
          filename: favoriteSong.filename,
          hasLyrics: favoriteSong.hasLyrics || false,
          lrcUrl: favoriteSong.lrcUrl,
          duration: favoriteSong.duration || 0
        }
        await playSong(newSong)
      }
    }
    
    /**
     * 显示右键菜单
     */
    function showContextMenu(event, song) {
      event.preventDefault()
      contextMenu.value = {
        show: true,
        x: event.clientX,
        y: event.clientY,
        song: song
      }
    }
    
    /**
     * 隐藏右键菜单
     */
    function hideContextMenu() {
      contextMenu.value.show = false
    }
    
    /**
     * 处理右键菜单操作
     */
    function handleContextMenuAction(action) {
      const song = contextMenu.value.song
      if (!song) return
      
      switch (action) {
        case 'play':
          playSong(song)
          break
        case 'addToFavorites':
          if (props.isLoggedIn) {
            emit('add-favorite', song)
          } else {
            alert('请先登录后再收藏歌曲')
            emit('open-login')
          }
          break
        case 'removeFromFavorites':
          if (props.isLoggedIn) {
            emit('remove-favorite', song.filename)
          }
          break
      }
      
      hideContextMenu()
    }
    
    /**
     * 获取默认封面
     */
    function getDefaultCover() {
      return playerService?.getDefaultCover() || 
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23e0e0e0"/%3E%3C/svg%3E'
    }
    
    /**
     * 键盘快捷键处理
     */
    function handleKeydown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return
      }
      
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          prevSong()
          break
        case 'ArrowRight':
          nextSong()
          break
        case 'ArrowUp':
          e.preventDefault()
          if (playerService) {
            playerService.setVolume(Math.min(1, volume.value + 0.1))
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (playerService) {
            playerService.setVolume(Math.max(0, volume.value - 0.1))
          }
          break
      }
    }
    
    // ========== 生命周期 ==========
    
    onMounted(async () => {
      await initPlayer()
      
      // 添加键盘事件监听
      document.addEventListener('keydown', handleKeydown)
      document.addEventListener('click', hideContextMenu)
    })
    
    onUnmounted(() => {
      // 移除事件监听
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('click', hideContextMenu)
      
      // 销毁服务
      playerService?.destroy()
    })
    
    // 监听歌词索引变化，自动滚动（居中显示当前歌词）
    watch(currentLyricIndex, (newIndex) => {
      if (newIndex >= 0) {
        nextTick(() => {
          const lyricsContainer = document.querySelector('.lyrics-container')
          const activeLine = document.querySelector('.lyric-line.active')
          if (lyricsContainer && activeLine) {
            const container = lyricsContainer.parentElement
            const containerHeight = container?.clientHeight || 200
            const lineHeight = activeLine.clientHeight
            // 计算当前行相对于容器顶部的偏移
            const lineOffsetTop = activeLine.offsetTop
            // 计算需要滚动的距离：让当前行居中
            const scrollOffset = lineOffsetTop - containerHeight / 2 + lineHeight / 2
            // 应用偏移（容器初始在50%位置）
            lyricsContainer.style.transform = `translateY(calc(-50% - ${scrollOffset}px))`
          }
        })
      }
    })
    
    // ========== 返回值 ==========
    return {
      // 状态
      isInitializing,
      searchQuery,
      isDragging,
      showUserMenu,
      contextMenu,

      // Store
      store,

      // Store 状态
      state,
      playlist,
      currentSong,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      volume,
      isMuted,
      playMode,
      showPlaylist,
      lyrics,
      currentLyricIndex,
      autoPlayBlocked,
      progressPercent,
      filteredPlaylist,
      playModeConfig,

      // 方法
      playSong,
      togglePlay,
      prevSong,
      nextSong,
      togglePlayMode,
      setVolume,
      toggleMute,
      seek,
      startDrag,
      refreshPlaylist,
      loadMusicList,
      playFavoriteSong,
      showContextMenu,
      hideContextMenu,
      handleContextMenuAction,
      getDefaultCover,
      formatTime,

      // 事件发射
      emit,

      // Props
      props
    }
  },
  
  template: `
    <div class="music-player">
      <!-- 初始化加载状态 -->
      <div v-if="isInitializing" class="player-loading">
        <i class="fas fa-spinner fa-spin"></i>
        <span>正在初始化播放器...</span>
      </div>
      
      <!-- 主播放器区域 -->
      <div v-else class="player-main">
        <!-- 歌曲信息 -->
        <div class="song-info">
          <div class="album-cover" :class="{ 'playing': isPlaying }">
            <LazyImage :src="currentSong?.cover || getDefaultCover()" :alt="currentSong?.title" className="" />
          </div>
          <div class="song-details">
            <h2 class="song-title">{{ currentSong?.title || '未选择歌曲' }}</h2>
            <p class="song-artist">{{ currentSong?.artist || '-' }}</p>
          </div>
        </div>

        <!-- 歌词显示 -->
        <LyricsComponent
          v-if="currentSong?.hasLyrics"
          :lyrics="lyrics"
          :current-lyric-index="currentLyricIndex"
          :current-time="currentTime"
          :bilingual-mode="'vertical'"
          @seek="seek"
        />


        <!-- 进度条 -->
        <div class="progress-section">
          <div class="time-display">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
          <div class="progress-bar" @mousedown="startDrag">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            <div class="progress-handle" :style="{ left: progressPercent + '%' }"></div>
          </div>
        </div>

        <!-- 控制按钮 -->
        <div class="controls">
          <button 
            class="control-btn mode-btn" 
            @click="togglePlayMode" 
            :title="playModeConfig.description"
          >
            <i :class="['fas', playModeConfig.icon]"></i>
          </button>

          <button class="control-btn" @click="prevSong" :disabled="playlist.length === 0">
            <i class="fas fa-step-backward"></i>
          </button>

          <button 
            class="control-btn play-btn" 
            @click="togglePlay" 
            :class="{ 'blocked': autoPlayBlocked }"
            :disabled="!currentSong"
          >
            <i :class="['fas', isPlaying ? 'fa-pause' : 'fa-play']"></i>
            <span v-if="autoPlayBlocked" class="play-hint">点击播放</span>
          </button>

          <button class="control-btn" @click="nextSong" :disabled="playlist.length === 0">
            <i class="fas fa-step-forward"></i>
          </button>

          <button 
            class="control-btn playlist-toggle" 
            @click="store?.mutations.setShowPlaylist(!showPlaylist)"
            :class="{ 'active': showPlaylist }"
          >
            <i class="fas fa-list"></i>
          </button>
        </div>

        <!-- 音量控制 -->
        <div class="volume-section">
          <button class="volume-btn" @click="toggleMute">
            <i :class="['fas', 
              isMuted || volume === 0 ? 'fa-volume-mute' : 
              volume < 0.5 ? 'fa-volume-down' : 
              'fa-volume-up'
            ]"></i>
          </button>
          <div class="volume-bar" @mousedown="setVolume">
            <div class="volume-fill" :style="{ width: (isMuted ? 0 : volume) * 100 + '%' }"></div>
          </div>
        </div>

        <!-- 上传按钮 -->
        <button class="upload-trigger-btn" @click="$emit('open-upload')">
          <i class="fas fa-cloud-upload-alt"></i>
          上传音乐
        </button>
      </div>

      <!-- 播放列表 -->
      <div class="playlist" :class="{ 'show': showPlaylist }">
        <div class="playlist-header">
          <h3>播放列表</h3>
          <div class="playlist-actions">
            <button 
              v-if="!props.isLoggedIn" 
              class="login-btn-small" 
              @click="$emit('open-login')" 
              title="登录"
            >
              <i class="fas fa-user"></i>
            </button>
            <button 
              v-else 
              class="login-btn-small logged-in" 
              @click="$emit('logout')" 
              title="退出登录"
            >
              <i class="fas fa-user-check"></i>
            </button>
            <button class="refresh-btn" @click="refreshPlaylist" title="刷新列表">
              <i class="fas fa-sync-alt" :class="{ 'spin': isLoading }"></i>
            </button>
            <span class="song-count">{{ playlist.length }} 首歌曲</span>
          </div>
        </div>
        
        <!-- 搜索框 -->
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="搜索歌曲、歌手..." 
            class="search-input"
          >
          <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <!-- 歌曲列表 -->
        <div class="playlist-items">
          <div v-if="playlist.length === 0" class="empty-playlist">
            <i class="fas fa-music"></i>
            <p>暂无音乐</p>
            <button class="upload-link" @click="$emit('open-upload')">点击上传音乐</button>
            <button class="upload-link" @click="console.log('Store:', store, 'State:', store?.state, 'Playlist:', store?.state?.playlist)" style="margin-top: 10px;">调试信息</button>
          </div>
          <div v-else-if="filteredPlaylist.length === 0" class="empty-playlist">
            <i class="fas fa-search"></i>
            <p>未找到匹配的歌曲</p>
            <button class="upload-link" @click="searchQuery = ''">清除搜索</button>
          </div>
          <div
            v-for="song in filteredPlaylist"
            :key="song.id"
            class="playlist-item"
            :class="{ 'active': currentSong?.id === song.id }"
            @click="playSong(song)"
            @contextmenu="showContextMenu($event, song)"
          >
            <div class="item-number">
              <span v-if="currentSong?.id === song.id && isPlaying">
                <i class="fas fa-volume-up"></i>
              </span>
              <span v-else-if="currentSong?.id === song.id && autoPlayBlocked">
                <i class="fas fa-play" style="color: var(--accent-color);"></i>
              </span>
              <span v-else>{{ playlist.findIndex(s => s.id === song.id) + 1 }}</span>
            </div>
            <LazyImage :src="song.cover" :alt="song.title" className="item-cover" />
            <div class="item-info">
              <div class="item-title">
                {{ song.title }}
                <i v-if="song.hasLyrics" class="fas fa-align-left lyrics-icon" title="有歌词"></i>
              </div>
              <div class="item-artist">{{ song.artist }}</div>
            </div>
            <button
              v-if="props.isLoggedIn"
              class="favorite-btn"
              :class="{ 'is-favorite': props.favorites.some(f => f.filename === song.filename) }"
              @click.stop="props.favorites.some(f => f.filename === song.filename) 
                ? $emit('remove-favorite', song.filename) 
                : $emit('add-favorite', song)"
            >
              <i :class="['fas', props.favorites.some(f => f.filename === song.filename) ? 'fa-heart' : 'fa-regular fa-heart']"></i>
            </button>
            <div class="item-duration">{{ formatTime(song.duration) }}</div>
          </div>
        </div>
      </div>

      <!-- 收藏列表（独立面板） -->
      <div v-if="props.isLoggedIn" class="favorites-panel">
        <div class="playlist-header">
          <h3><i class="fas fa-heart"></i> 收藏列表</h3>
          <span class="song-count">{{ props.favorites.length }} 首</span>
        </div>
        
        <!-- 收藏歌曲列表 -->
        <div class="playlist-items favorites-items">
          <div v-if="props.favorites.length === 0" class="empty-playlist">
            <i class="far fa-heart"></i>
            <p>暂无收藏</p>
            <span style="font-size: 12px; opacity: 0.7;">
              点击 <i class="far fa-heart" style="color: var(--accent-color);"></i> 添加收藏
            </span>
          </div>
          <div
            v-for="(song, index) in props.favorites"
            :key="song.filename"
            class="playlist-item"
            :class="{ 'active': currentSong?.filename === song.filename }"
            @click="playFavoriteSong(song)"
          >
            <div class="item-number">
              <span v-if="currentSong?.filename === song.filename && isPlaying">
                <i class="fas fa-volume-up" style="color: var(--accent-color);"></i>
              </span>
              <span v-else>{{ index + 1 }}</span>
            </div>
            <LazyImage :src="song.coverUrl || song.cover || getDefaultCover()" :alt="song.title" className="item-cover" />
            <div class="item-info">
              <div class="item-title">{{ song.title }}</div>
              <div class="item-artist">{{ song.artist }}</div>
            </div>
            <button
              class="favorite-btn is-favorite"
              @click.stop="$emit('remove-favorite', song.filename)"
              title="取消收藏"
            >
              <i class="fas fa-heart"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- 快捷键提示 -->
      <div class="shortcuts-hint">
        <span>空格: 播放/暂停</span>
        <span>← →: 切换歌曲</span>
        <span>↑ ↓: 音量调节</span>
      </div>

      <!-- 右键菜单 -->
      <div 
        v-if="contextMenu.show" 
        class="context-menu" 
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" 
        @click.stop
      >
        <div class="context-menu-header">
          <i class="fas fa-music"></i>
          <span class="context-menu-title">{{ contextMenu.song?.title || '歌曲操作' }}</span>
        </div>
        <div class="context-menu-divider"></div>
        <button class="context-menu-item" @click="handleContextMenuAction('play')">
          <i class="fas fa-play"></i>
          <span>播放</span>
        </button>
        <button 
          v-if="props.isLoggedIn && !props.favorites.some(f => f.filename === contextMenu.song?.filename)" 
          class="context-menu-item" 
          @click="handleContextMenuAction('addToFavorites')"
        >
          <i class="fas fa-heart"></i>
          <span>添加到收藏</span>
        </button>
        <button 
          v-if="props.isLoggedIn && props.favorites.some(f => f.filename === contextMenu.song?.filename)" 
          class="context-menu-item remove" 
          @click="handleContextMenuAction('removeFromFavorites')"
        >
          <i class="fas fa-heart-broken"></i>
          <span>取消收藏</span>
        </button>
      </div>
    </div>
  `
}
