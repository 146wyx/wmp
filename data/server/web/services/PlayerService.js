/**
 * PlayerService - 核心播放服务
 * 负责音频播放控制、事件处理和播放逻辑
 */

import { getPlayerStore } from '../stores/PlayerStore.js'
import { 
  AudioErrorTypes, 
  PlayModes, 
  parseAudioError, 
  getNextIndex, 
  getPrevIndex,
  throttle,
  formatTime
} from '../utils/AudioUtils.js'
import LyricsParser from '../utils/LyricsParser.js'
import { StorageUtils, PlayerStorageKeys } from '../utils/StorageUtils.js'

class PlayerService {
  constructor() {
    // 音频元素
    this.audio = null
    
    // 播放器状态存储
    this.store = null
    
    // 事件监听器
    this.eventListeners = {}
    
    // 节流保存进度
    this.throttledSaveProgress = throttle(() => {
      this.saveProgress()
    }, 5000)
    
    // 歌词解析器
    this.lyricsParser = new LyricsParser()
    
    // 初始化状态
    this.isInitialized = false
  }

  /**
   * 初始化播放器
   */
  async init() {
    if (this.isInitialized) return

    // 获取状态存储
    this.store = getPlayerStore()
    
    // 创建音频元素
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'metadata'
    
    // 绑定事件
    this.bindAudioEvents()
    
    // 恢复设置
    await this.restoreSettings()
    
    this.isInitialized = true
    console.log('[PlayerService] Initialized')
  }

  /**
   * 绑定音频事件
   */
  bindAudioEvents() {
    // 时间更新
    this.audio.addEventListener('timeupdate', () => {
      this.handleTimeUpdate()
    })

    // 元数据加载完成
    this.audio.addEventListener('loadedmetadata', () => {
      this.handleLoadedMetadata()
    })

    // 可以播放
    this.audio.addEventListener('canplay', () => {
      this.handleCanPlay()
    })

    // 正在缓冲
    this.audio.addEventListener('waiting', () => {
      this.handleWaiting()
    })

    // 缓冲完成
    this.audio.addEventListener('playing', () => {
      this.handlePlaying()
    })

    // 播放结束
    this.audio.addEventListener('ended', () => {
      this.handleEnded()
    })

    // 错误
    this.audio.addEventListener('error', () => {
      this.handleError()
    })

    // 加载开始
    this.audio.addEventListener('loadstart', () => {
      this.handleLoadStart()
    })

    // 加载完成
    this.audio.addEventListener('loadeddata', () => {
      this.handleLoadedData()
    })

    // 进度（缓冲）
    this.audio.addEventListener('progress', () => {
      this.handleProgress()
    })
  }

  /**
   * 恢复设置
   */
  async restoreSettings() {
    const { mutations } = this.store
    
    // 恢复音量
    const savedVolume = StorageUtils.get(PlayerStorageKeys.VOLUME, 0.7)
    const savedMuted = StorageUtils.get(PlayerStorageKeys.MUTED, false)
    
    this.audio.volume = savedMuted ? 0 : savedVolume
    mutations.setVolume(savedVolume)
    mutations.setMuted(savedMuted)
    
    console.log('[PlayerService] Settings restored - volume:', savedVolume, 'muted:', savedMuted)
  }

  /**
   * 加载歌曲
   * @param {Object} song - 歌曲对象
   * @param {boolean} autoPlay - 是否自动播放
   */
  async load(song, autoPlay = true) {
    if (!song || !song.url) {
      console.error('[PlayerService] Invalid song:', song)
      return false
    }

    const { mutations } = this.store
    
    console.log('[PlayerService] Loading song:', song.title)
    
    // 重置音频进度为0
    this.audio.currentTime = 0
    
    // 重置状态
    mutations.reset()
    mutations.setCurrentTime(0)
    mutations.setLoading(true)
    mutations.setCurrentSong(song)
    
    // 设置音频源
    this.audio.src = song.url
    this.audio.load()
    
    // 加载歌词
    if (song.hasLyrics && song.lrcUrl) {
      await this.loadLyrics(song)
    } else {
      mutations.setLyrics([])
    }
    
    // 恢复播放进度（仅登录用户且重新加载同一首歌时）
    const userId = this.getCurrentUserId()
    if (userId && song.id === StorageUtils.get(PlayerStorageKeys.CURRENT_SONG_ID)) {
      const userKey = `user_${userId}_currentTime`
      const savedTime = StorageUtils.get(userKey, 0)
      if (savedTime > 0 && savedTime < song.duration) {
        this.audio.currentTime = savedTime
        mutations.setCurrentTime(savedTime)
      }
    }
    
    // 更新媒体会话（显示歌曲信息和封面）
    this.updateMediaSession(song)
    
    // 自动播放
    if (autoPlay) {
      try {
        await this.play()
      } catch (error) {
        console.warn('[PlayerService] Auto-play blocked:', error)
        mutations.setAutoPlayBlocked(true)
      }
    }
    
    return true
  }

  /**
   * 更新媒体会话（Media Session API）
   * @param {Object} song - 歌曲对象
   * @param {string} lyric - 当前歌词
   */
  updateMediaSession(song, lyric = '') {
    if (!('mediaSession' in navigator)) {
      console.log('[PlayerService] Media Session API not supported')
      return
    }

    // 构建显示格式：
    // - 有歌词时：标题="歌曲名 - 作者"，副标题=歌词
    // - 没歌词时：标题=歌曲名，副标题=作者
    const songTitle = song.title || 'Unknown Title'
    const songArtist = song.artist || 'Unknown Artist'
    const title = lyric ? `${songTitle} - ${songArtist}` : songTitle
    const artist = lyric || songArtist

    // 设置媒体元数据
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      album: song.album || '',
      artwork: song.cover ? [
        { src: song.cover, sizes: '96x96', type: 'image/jpeg' },
        { src: song.cover, sizes: '128x128', type: 'image/jpeg' },
        { src: song.cover, sizes: '192x192', type: 'image/jpeg' },
        { src: song.cover, sizes: '256x256', type: 'image/jpeg' },
        { src: song.cover, sizes: '384x384', type: 'image/jpeg' },
        { src: song.cover, sizes: '512x512', type: 'image/jpeg' }
      ] : []
    })

    // 设置媒体操作处理器
    navigator.mediaSession.setActionHandler('play', () => this.play())
    navigator.mediaSession.setActionHandler('pause', () => this.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous())
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next())

    console.log('[PlayerService] Media Session updated:', title, '-', artist)
  }

  /**
   * 更新媒体会话歌词
   * @param {string} lyric - 当前歌词
   */
  updateMediaSessionLyric(lyric) {
    const { state } = this.store
    if (!state.currentSong) return

    this.updateMediaSession(state.currentSong, lyric)
  }

  /**
   * 播放
   */
  async play() {
    const { mutations } = this.store
    
    try {
      mutations.setAutoPlayBlocked(false)
      await this.audio.play()
      mutations.setPlaying(true)
      console.log('[PlayerService] Playing')
      return true
    } catch (error) {
      console.error('[PlayerService] Play failed:', error)
      mutations.setPlaying(false)
      mutations.setAutoPlayBlocked(true)
      throw error
    }
  }

  /**
   * 暂停
   */
  pause() {
    const { mutations } = this.store
    
    this.audio.pause()
    mutations.setPlaying(false)
    console.log('[PlayerService] Paused')
  }

  /**
   * 切换播放/暂停
   */
  async toggle() {
    const { state } = this.store
    
    if (state.isPlaying) {
      this.pause()
    } else {
      await this.play()
    }
  }

  /**
   * 跳转到指定时间
   * @param {number} time - 时间（秒）
   */
  seek(time) {
    const { mutations } = this.store
    
    if (!this.audio || !isFinite(time)) return
    
    const clampedTime = Math.max(0, Math.min(time, this.audio.duration || time))
    this.audio.currentTime = clampedTime
    mutations.setCurrentTime(clampedTime)
    
    // 立即更新歌词索引
    this.updateLyricIndex()
    
    console.log('[PlayerService] Seek to:', formatTime(clampedTime))
  }

  /**
   * 下一首
   */
  async next() {
    const { state, mutations } = this.store
    
    if (state.playQueue.length === 0) {
      console.warn('[PlayerService] No songs in queue')
      return false
    }
    
    let nextIndex
    
    if (state.playMode === PlayModes.RANDOM) {
      // 随机模式下使用队列中的下一首
      nextIndex = (state.currentIndex + 1) % state.playQueue.length
    } else {
      // 其他模式
      nextIndex = getNextIndex(state.currentIndex, state.playQueue.length, state.playMode)
    }
    
    const nextSong = state.playQueue[nextIndex]
    
    if (nextSong) {
      mutations.setCurrentIndex(nextIndex)
      await this.load(nextSong, true)
      return true
    }
    
    return false
  }

  /**
   * 上一首
   */
  async previous() {
    const { state, mutations } = this.store
    
    if (state.playQueue.length === 0) {
      console.warn('[PlayerService] No songs in queue')
      return false
    }
    
    // 如果当前播放时间超过3秒，则回到开头
    if (state.currentTime > 3) {
      this.seek(0)
      return true
    }
    
    const prevIndex = getPrevIndex(state.currentIndex, state.playQueue.length)
    const prevSong = state.playQueue[prevIndex]
    
    if (prevSong) {
      mutations.setCurrentIndex(prevIndex)
      await this.load(prevSong, true)
      return true
    }
    
    return false
  }

  /**
   * 设置音量
   * @param {number} volume - 音量（0-1）
   */
  setVolume(volume) {
    const { mutations } = this.store
    
    const clampedVolume = Math.max(0, Math.min(1, volume))
    
    this.audio.volume = clampedVolume
    mutations.setVolume(clampedVolume)
    
    // 如果设置音量大于0，取消静音
    if (clampedVolume > 0 && this.store.state.isMuted) {
      this.setMuted(false)
    }
    
    console.log('[PlayerService] Volume set to:', clampedVolume)
  }

  /**
   * 设置静音
   * @param {boolean} muted - 是否静音
   */
  setMuted(muted) {
    const { mutations } = this.store
    
    this.audio.muted = muted
    mutations.setMuted(muted)
    
    console.log('[PlayerService] Muted:', muted)
  }

  /**
   * 切换静音
   */
  toggleMute() {
    this.setMuted(!this.store.state.isMuted)
  }

  /**
   * 设置播放模式
   * @param {string} mode - 播放模式
   */
  setPlayMode(mode) {
    const { mutations } = this.store
    
    mutations.setPlayMode(mode)
    console.log('[PlayerService] Play mode set to:', mode)
  }

  /**
   * 切换播放模式
   */
  togglePlayMode() {
    const modes = [PlayModes.SEQUENCE, PlayModes.RANDOM, PlayModes.SINGLE, PlayModes.LOOP]
    const currentIndex = modes.indexOf(this.store.state.playMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    
    this.setPlayMode(nextMode)
  }

  /**
   * 加载歌词
   * @param {Object} song - 歌曲对象
   */
  async loadLyrics(song) {
    const { mutations } = this.store
    
    if (!song.lrcUrl) {
      mutations.setLyrics([])
      return
    }
    
    try {
      const response = await fetch(song.lrcUrl)
      const result = await response.json()
      
      if (result.success && result.data) {
        const lyrics = this.lyricsParser.parse(result.data)
        mutations.setLyrics(lyrics)
        console.log('[PlayerService] Lyrics loaded:', lyrics.length, 'lines')
      } else {
        mutations.setLyrics([])
      }
    } catch (error) {
      console.error('[PlayerService] Failed to load lyrics:', error)
      mutations.setLyrics([])
    }
  }

  /**
   * 更新歌词索引
   */
  updateLyricIndex() {
    const { state, mutations } = this.store
    
    if (!state.lyrics || state.lyrics.length === 0) return
    
    const index = this.lyricsParser.findIndex(state.lyrics, state.currentTime)
    // 无论索引是否变化，都更新 currentLyricIndex
    mutations.setCurrentLyricIndex(index)
    
    // 更新媒体会话歌词
    const currentLyric = state.lyrics[index]
    if (currentLyric) {
      const lyricText = currentLyric.text || ''
      this.updateMediaSessionLyric(lyricText)
    }
  }

  /**
   * 获取当前登录用户ID
   * @returns {string|null} 用户ID或null
   */
  getCurrentUserId() {
    try {
      const authData = localStorage.getItem('musicPlayerAuth')
      if (authData) {
        const parsed = JSON.parse(authData)
        if (parsed.isLoggedIn && parsed.user && parsed.user.id) {
          return parsed.user.id
        }
      }
    } catch (e) {
      console.error('[PlayerService] Error getting user ID:', e)
    }
    return null
  }

  /**
   * 保存播放进度（仅登录用户）
   */
  saveProgress() {
    const userId = this.getCurrentUserId()
    if (!userId) return // 未登录不保存

    const { state } = this.store
    
    if (state.currentSong && state.currentTime > 0) {
      // 使用用户特定的存储键
      const userKey = `user_${userId}_currentTime`
      StorageUtils.set(userKey, state.currentTime)
    }
  }

  /**
   * 添加到播放历史
   */
  addToHistory() {
    const { state, mutations } = this.store
    
    if (state.currentSong) {
      mutations.addToHistory(state.currentSong, state.currentTime)
    }
  }

  // ========== 事件处理器 ==========

  handleTimeUpdate() {
    if (!this.store) return
    
    const { mutations } = this.store
    if (!mutations || !mutations.setCurrentTime) return
    
    mutations.setCurrentTime(this.audio.currentTime)
    this.updateLyricIndex()
    
    // 节流保存进度
    this.throttledSaveProgress()
  }

  handleLoadedMetadata() {
    const { mutations } = this.store
    
    mutations.setDuration(this.audio.duration)
    console.log('[PlayerService] Metadata loaded, duration:', formatTime(this.audio.duration))
  }

  handleCanPlay() {
    const { mutations } = this.store
    
    mutations.setAudioReady(true)
    mutations.setLoading(false)
    console.log('[PlayerService] Can play')
  }

  handleWaiting() {
    const { mutations } = this.store
    
    mutations.setBuffering(true)
    console.log('[PlayerService] Buffering...')
  }

  handlePlaying() {
    const { mutations } = this.store
    
    mutations.setBuffering(false)
    console.log('[PlayerService] Playing/Resumed')
  }

  handleEnded() {
    const { state, mutations } = this.store
    
    console.log('[PlayerService] Song ended')
    
    // 重置进度为0
    mutations.setCurrentTime(0)
    
    // 添加到历史
    this.addToHistory()
    
    // 根据播放模式处理
    if (state.playMode === PlayModes.SINGLE) {
      // 单曲循环
      this.seek(0)
      this.play()
    } else {
      // 播放下一首
      this.next()
    }
  }

  handleError() {
    const { mutations } = this.store
    
    const error = parseAudioError(this.audio)
    mutations.setError(error)
    mutations.setLoading(false)
    mutations.setPlaying(false)
    
    console.error('[PlayerService] Audio error:', error)
    
    // 错误恢复逻辑
    if (this.store.state.errorCount >= 3) {
      console.warn('[PlayerService] Too many errors, skipping to next song')
      this.next()
    }
  }

  handleLoadStart() {
    const { mutations } = this.store
    
    mutations.setLoading(true)
    console.log('[PlayerService] Load started')
  }

  handleLoadedData() {
    console.log('[PlayerService] Data loaded')
  }

  handleProgress() {
    // 可以在这里处理缓冲进度
  }

  // ========== 播放列表管理 ==========

  /**
   * 设置播放列表
   * @param {Array} playlist - 播放列表
   */
  setPlaylist(playlist) {
    const { mutations } = this.store
    
    mutations.setPlaylist(playlist)
    console.log('[PlayerService] Playlist set:', playlist.length, 'songs')
  }

  /**
   * 播放指定歌曲
   * @param {Object} song - 歌曲对象
   */
  async playSong(song) {
    const { state, mutations } = this.store
    
    // 找到歌曲在队列中的索引
    const index = state.playQueue.findIndex(s => s.id === song.id)
    if (index >= 0) {
      mutations.setCurrentIndex(index)
    }
    
    await this.load(song, true)
  }

  /**
   * 获取默认封面
   */
  getDefaultCover() {
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23e0e0e0"/%3E%3C/svg%3E'
  }

  /**
   * 销毁播放器
   */
  destroy() {
    // 保存进度
    this.saveProgress()
    
    // 暂停播放
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
    }
    
    this.isInitialized = false
    console.log('[PlayerService] Destroyed')
  }
}

// 单例模式
let playerServiceInstance = null

function createPlayerService() {
  if (!playerServiceInstance) {
    playerServiceInstance = new PlayerService()
  }
  return playerServiceInstance
}

function getPlayerService() {
  return createPlayerService()
}

export { PlayerService, createPlayerService, getPlayerService }
export default PlayerService
