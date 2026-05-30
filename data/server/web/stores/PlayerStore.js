/**
 * PlayerStore - 播放器状态管理中心
 * 使用 Vue 3 的 reactive 系统实现状态管理
 */

import { StorageUtils, PlayerStorageKeys } from '../utils/StorageUtils.js'
import { PlayModes, generatePlayQueue } from '../utils/AudioUtils.js'

// 创建响应式状态
function createPlayerState() {
  const { reactive, readonly } = window.Vue

  // 内部状态
  const state = reactive({
    // 播放状态
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    isAudioReady: false,

    // 当前歌曲
    currentSong: null,
    currentTime: 0,
    duration: 0,

    // 播放队列
    playlist: [],
    playQueue: [],
    currentIndex: -1,

    // 播放模式
    playMode: StorageUtils.get(PlayerStorageKeys.PLAY_MODE, PlayModes.SEQUENCE),

    // 音量
    volume: StorageUtils.get(PlayerStorageKeys.VOLUME, 0.7),
    isMuted: StorageUtils.get(PlayerStorageKeys.MUTED, false),

    // 播放历史
    history: StorageUtils.get(PlayerStorageKeys.HISTORY, []),

    // 错误状态
    error: null,
    errorCount: 0,

    // 自动播放被阻止
    autoPlayBlocked: false,

    // 歌词
    lyrics: [],
    currentLyricIndex: -1,

    // 播放列表显示状态
    showPlaylist: true
  })

  // 计算属性
  const getters = {
    // 进度百分比
    progressPercent: () => {
      if (!state.duration || state.duration === 0) return 0
      return (state.currentTime / state.duration) * 100
    },

    // 是否有下一首
    hasNext: () => {
      if (state.playQueue.length === 0) return false
      if (state.playMode === PlayModes.SINGLE) return true
      return state.currentIndex < state.playQueue.length - 1 || state.playMode === PlayModes.LOOP
    },

    // 是否有上一首
    hasPrev: () => {
      if (state.playQueue.length === 0) return false
      return state.currentIndex > 0 || state.playMode === PlayModes.LOOP || state.playMode === PlayModes.RANDOM
    },

    // 当前播放模式配置
    playModeConfig: () => {
      const { PlayModeConfig } = window.PlayerServices?.AudioUtils || {}
      return PlayModeConfig?.[state.playMode] || { name: '顺序播放', icon: 'fa-arrow-down-a-z' }
    },

    // 过滤后的播放列表（用于搜索）
    filteredPlaylist: (searchQuery = '') => {
      if (!searchQuery || !searchQuery.trim()) return state.playlist
      const query = searchQuery.toLowerCase().trim()
      return state.playlist.filter(song =>
        (song.title && song.title.toLowerCase().includes(query)) ||
        (song.artist && song.artist.toLowerCase().includes(query))
      )
    }
  }

  // Mutations - 同步修改状态
  const mutations = {
    // 设置播放状态
    setPlaying(playing) {
      state.isPlaying = playing
    },

    // 设置加载状态
    setLoading(loading) {
      state.isLoading = loading
    },

    // 设置缓冲状态
    setBuffering(buffering) {
      state.isBuffering = buffering
    },

    // 设置音频就绪状态
    setAudioReady(ready) {
      state.isAudioReady = ready
    },

    // 设置当前歌曲
    setCurrentSong(song) {
      state.currentSong = song
      if (song) {
        StorageUtils.set(PlayerStorageKeys.CURRENT_SONG_ID, song.id)
      }
    },

    // 设置当前时间
    setCurrentTime(time) {
      state.currentTime = Math.max(0, Math.min(time, state.duration || time))
    },

    // 设置总时长
    setDuration(duration) {
      state.duration = duration || 0
    },

    // 设置播放列表
    setPlaylist(playlist) {
      state.playlist = playlist || []
      // 重新生成播放队列
      const { generatePlayQueue } = window.PlayerServices?.AudioUtils || {}
      if (generatePlayQueue) {
        state.playQueue = generatePlayQueue(state.playlist, state.playMode, state.history)
      } else {
        state.playQueue = [...state.playlist]
      }
    },

    // 设置播放队列
    setPlayQueue(queue) {
      state.playQueue = queue || []
    },

    // 设置当前索引
    setCurrentIndex(index) {
      state.currentIndex = index
    },

    // 设置播放模式
    setPlayMode(mode) {
      state.playMode = mode
      StorageUtils.set(PlayerStorageKeys.PLAY_MODE, mode)
      // 重新生成播放队列
      this.generateQueue()
    },

    // 设置音量
    setVolume(volume) {
      state.volume = Math.max(0, Math.min(1, volume))
      StorageUtils.set(PlayerStorageKeys.VOLUME, state.volume)
    },

    // 设置静音
    setMuted(muted) {
      state.isMuted = muted
      StorageUtils.set(PlayerStorageKeys.MUTED, muted)
    },

    // 设置错误
    setError(error) {
      state.error = error
      if (error) {
        state.errorCount++
      } else {
        state.errorCount = 0
      }
    },

    // 清除错误
    clearError() {
      state.error = null
      state.errorCount = 0
    },

    // 设置自动播放阻止状态
    setAutoPlayBlocked(blocked) {
      state.autoPlayBlocked = blocked
    },

    // 设置歌词
    setLyrics(lyrics) {
      state.lyrics = lyrics || []
      state.currentLyricIndex = -1
    },

    // 设置当前歌词索引
    setCurrentLyricIndex(index) {
      state.currentLyricIndex = index
    },

    // 设置播放列表显示状态
    setShowPlaylist(show) {
      state.showPlaylist = show
    },

    // 生成播放队列
    generateQueue() {
      const { generatePlayQueue } = window.PlayerServices?.AudioUtils || {}
      if (generatePlayQueue) {
        state.playQueue = generatePlayQueue(state.playlist, state.playMode, state.history)
      } else {
        state.playQueue = [...state.playlist]
      }
    },

    // 添加到历史记录
    addToHistory(song, playTime = 0) {
      if (!song) return

      // 移除已存在的相同歌曲
      state.history = state.history.filter(h => h.id !== song.id)

      // 添加到开头
      state.history.unshift({
        id: song.id,
        title: song.title,
        artist: song.artist,
        filename: song.filename,
        playTime: playTime,
        timestamp: Date.now()
      })

      // 限制历史记录数量
      const maxHistory = 100
      if (state.history.length > maxHistory) {
        state.history = state.history.slice(0, maxHistory)
      }

      // 持久化
      StorageUtils.set(PlayerStorageKeys.HISTORY, state.history)
    },

    // 重置状态
    reset() {
      state.isPlaying = false
      state.isLoading = false
      state.isBuffering = false
      state.isAudioReady = false
      state.currentTime = 0
      state.duration = 0
      state.error = null
      state.errorCount = 0
      state.autoPlayBlocked = false
      state.lyrics = []
      state.currentLyricIndex = -1
    }
  }

  // Actions - 异步操作或复杂逻辑
  const actions = {
    // 初始化播放器
    async init() {
      // 恢复音量设置
      const savedVolume = StorageUtils.get(PlayerStorageKeys.VOLUME, 0.7)
      const savedMuted = StorageUtils.get(PlayerStorageKeys.MUTED, false)
      mutations.setVolume(savedVolume)
      mutations.setMuted(savedMuted)

      // 恢复播放模式
      const savedMode = StorageUtils.get(PlayerStorageKeys.PLAY_MODE, PlayModes.SEQUENCE)
      mutations.setPlayMode(savedMode)

      console.log('[PlayerStore] Initialized')
    },

    // 加载播放列表
    async loadPlaylist(playlist) {
      mutations.setLoading(true)
      try {
        mutations.setPlaylist(playlist)
        console.log('[PlayerStore] Playlist loaded:', playlist.length, 'songs')
      } finally {
        mutations.setLoading(false)
      }
    },

    // 保存播放进度
    saveProgress() {
      if (state.currentSong && state.currentTime > 0) {
        StorageUtils.set(PlayerStorageKeys.CURRENT_TIME, state.currentTime)
      }
    },

    // 恢复播放进度
    restoreProgress() {
      const savedTime = StorageUtils.get(PlayerStorageKeys.CURRENT_TIME, 0)
      if (savedTime > 0) {
        mutations.setCurrentTime(savedTime)
        return savedTime
      }
      return 0
    }
  }

  return {
    state,
    getters,
    mutations,
    actions
  }
}

// 单例模式
let playerStore = null

function createPlayerStore() {
  if (!playerStore) {
    playerStore = createPlayerState()
  }
  return playerStore
}

function getPlayerStore() {
  return createPlayerStore()
}

// 导出
export { createPlayerStore, getPlayerStore }
export default createPlayerStore
