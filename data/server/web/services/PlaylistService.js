/**
 * PlaylistService - 播放列表管理服务
 * 负责播放列表的加载、搜索、筛选和管理
 */

import { getPlayerStore } from '../stores/PlayerStore.js'

class PlaylistService {
  constructor() {
    this.store = null
    this.isInitialized = false
    
    // API 基础 URL
    this.apiBaseUrl = ''
    
    // 缓存
    this.cache = {
      playlist: null,
      lastFetch: 0,
      cacheDuration: 5 * 60 * 1000 // 5分钟缓存
    }
  }

  /**
   * 初始化服务
   */
  async init() {
    if (this.isInitialized) return
    
    this.store = getPlayerStore()
    this.isInitialized = true
    
    console.log('[PlaylistService] Initialized')
  }

  /**
   * 从服务器加载播放列表
   * @param {boolean} forceRefresh - 强制刷新缓存
   * @returns {Promise<Array>} 播放列表
   */
  async loadPlaylist(forceRefresh = false) {
    const { mutations } = this.store
    
    // 检查缓存
    if (!forceRefresh && this.cache.playlist) {
      const now = Date.now()
      if (now - this.cache.lastFetch < this.cache.cacheDuration) {
        console.log('[PlaylistService] Using cached playlist')
        mutations.setPlaylist(this.cache.playlist)
        return this.cache.playlist
      }
    }
    
    mutations.setLoading(true)
    
    try {
      // 使用当前页面的 origin 构建完整 URL
      const baseUrl = window.location.origin
      console.log('[PlaylistService] Fetching from:', `${baseUrl}/api/music-list`)
      const response = await fetch(`${baseUrl}/api/music-list`)
      console.log('[PlaylistService] Response status:', response.status)
      const result = await response.json()
      console.log('[PlaylistService] Response result:', result.success, result.data ? result.data.length : 0, 'items')
      
      if (result.success && result.data) {
        // 处理歌曲数据
        const playlist = result.data.map(item => this.processSongData(item))
        
        // 更新缓存
        this.cache.playlist = playlist
        this.cache.lastFetch = Date.now()
        
        // 更新状态
        mutations.setPlaylist(playlist)
        
        console.log('[PlaylistService] Playlist loaded:', playlist.length, 'songs')
        return playlist
      } else {
        throw new Error(result.error || 'Failed to load playlist')
      }
    } catch (error) {
      console.error('[PlaylistService] Load playlist error:', error)
      throw error
    } finally {
      mutations.setLoading(false)
    }
  }

  /**
   * 处理歌曲数据
   * @param {Object} item - 原始歌曲数据
   * @returns {Object} 处理后的歌曲数据
   */
  processSongData(item) {
    const origin = window.location.origin
    
    return {
      id: item.id,
      filename: item.filename,
      title: item.title || this.parseTitleFromFilename(item.filename),
      artist: item.artist || 'Unknown Artist',
      album: item.album || '',
      duration: item.duration || 0,
      size: item.size || 0,
      mimeType: item.mime_type || 'audio/mpeg',
      url: item.url?.startsWith('http') ? item.url : `${origin}${item.url}`,
      cover: item.coverUrl || this.getDefaultCover(),
      hasLyrics: item.hasLyrics || false,
      lrcUrl: item.lrcUrl,
      hasCover: item.hasCover || false,
      coverUrl: item.coverUrl
    }
  }

  /**
   * 从文件名解析标题
   * @param {string} filename - 文件名
   * @returns {string} 标题
   */
  parseTitleFromFilename(filename) {
    if (!filename) return 'Unknown'
    
    // 移除扩展名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    
    // 尝试分割艺术家和标题
    const normalizedName = nameWithoutExt.replace(/[\u2013\u2014]/g, '-')
    
    if (normalizedName.includes('-')) {
      const parts = normalizedName.split('-')
      return parts[0].trim()
    }
    
    return nameWithoutExt
  }

  /**
   * 获取默认封面
   * @returns {string} 默认封面URL
   */
  getDefaultCover() {
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23e0e0e0"/%3E%3C/svg%3E'
  }

  /**
   * 搜索歌曲
   * @param {string} keyword - 搜索关键词
   * @returns {Array} 搜索结果
   */
  search(keyword) {
    const { state } = this.store
    
    if (!keyword || !keyword.trim()) {
      return state.playlist
    }
    
    const query = keyword.toLowerCase().trim()
    
    return state.playlist.filter(song => {
      const titleMatch = song.title && song.title.toLowerCase().includes(query)
      const artistMatch = song.artist && song.artist.toLowerCase().includes(query)
      const albumMatch = song.album && song.album.toLowerCase().includes(query)
      const filenameMatch = song.filename && song.filename.toLowerCase().includes(query)
      
      return titleMatch || artistMatch || albumMatch || filenameMatch
    })
  }

  /**
   * 按艺术家筛选
   * @param {string} artist - 艺术家名称
   * @returns {Array} 筛选结果
   */
  filterByArtist(artist) {
    const { state } = this.store
    
    if (!artist) {
      return state.playlist
    }
    
    return state.playlist.filter(song => 
      song.artist && song.artist.toLowerCase() === artist.toLowerCase()
    )
  }

  /**
   * 获取所有艺术家
   * @returns {Array} 艺术家列表
   */
  getAllArtists() {
    const { state } = this.store
    
    const artists = new Set()
    state.playlist.forEach(song => {
      if (song.artist) {
        artists.add(song.artist)
      }
    })
    
    return Array.from(artists).sort()
  }

  /**
   * 根据ID获取歌曲
   * @param {number} id - 歌曲ID
   * @returns {Object|null} 歌曲对象
   */
  getSongById(id) {
    const { state } = this.store
    return state.playlist.find(song => song.id === id) || null
  }

  /**
   * 根据文件名获取歌曲
   * @param {string} filename - 文件名
   * @returns {Object|null} 歌曲对象
   */
  getSongByFilename(filename) {
    const { state } = this.store
    return state.playlist.find(song => song.filename === filename) || null
  }

  /**
   * 获取歌曲索引
   * @param {number} id - 歌曲ID
   * @returns {number} 索引，-1表示未找到
   */
  getSongIndex(id) {
    const { state } = this.store
    return state.playlist.findIndex(song => song.id === id)
  }

  /**
   * 重新排序播放列表
   * @param {number} fromIndex - 原始索引
   * @param {number} toIndex - 目标索引
   */
  reorderPlaylist(fromIndex, toIndex) {
    const { state, mutations } = this.store
    
    if (fromIndex < 0 || fromIndex >= state.playlist.length) return
    if (toIndex < 0 || toIndex >= state.playlist.length) return
    if (fromIndex === toIndex) return
    
    const newPlaylist = [...state.playlist]
    const [movedItem] = newPlaylist.splice(fromIndex, 1)
    newPlaylist.splice(toIndex, 0, movedItem)
    
    mutations.setPlaylist(newPlaylist)
    
    // 清除缓存
    this.clearCache()
    
    console.log('[PlaylistService] Playlist reordered:', fromIndex, '->', toIndex)
  }

  /**
   * 获取随机歌曲
   * @param {number} count - 数量
   * @param {Array} excludeIds - 排除的歌曲ID
   * @returns {Array} 随机歌曲列表
   */
  getRandomSongs(count = 1, excludeIds = []) {
    const { state } = this.store
    
    const available = state.playlist.filter(song => !excludeIds.includes(song.id))
    
    if (available.length === 0) return []
    if (available.length <= count) return [...available]
    
    // Fisher-Yates 洗牌
    const shuffled = [...available]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    
    return shuffled.slice(0, count)
  }

  /**
   * 获取播放统计
   * @returns {Object} 统计信息
   */
  getStats() {
    const { state } = this.store
    
    const totalDuration = state.playlist.reduce((sum, song) => sum + (song.duration || 0), 0)
    const artists = this.getAllArtists()
    
    return {
      totalSongs: state.playlist.length,
      totalArtists: artists.length,
      totalDuration: totalDuration,
      hasLyrics: state.playlist.filter(s => s.hasLyrics).length,
      hasCover: state.playlist.filter(s => s.hasCover).length
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.playlist = null
    this.cache.lastFetch = 0
    console.log('[PlaylistService] Cache cleared')
  }

  /**
   * 刷新播放列表
   * @returns {Promise<Array>} 播放列表
   */
  async refresh() {
    this.clearCache()
    return await this.loadPlaylist(true)
  }
}

// 单例模式
let playlistServiceInstance = null

function createPlaylistService() {
  if (!playlistServiceInstance) {
    playlistServiceInstance = new PlaylistService()
  }
  return playlistServiceInstance
}

function getPlaylistService() {
  return createPlaylistService()
}

export { PlaylistService, createPlaylistService, getPlaylistService }
export default PlaylistService
