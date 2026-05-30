/**
 * HistoryService - 播放历史管理服务
 * 负责播放历史的记录、查询和持久化
 */

import { StorageUtils, PlayerStorageKeys } from '../utils/StorageUtils.js'
import { getPlayerStore } from '../stores/PlayerStore.js'

class HistoryService {
  constructor(options = {}) {
    this.store = null
    this.isInitialized = false
    
    // 配置
    this.config = {
      maxHistorySize: options.maxHistorySize || 100,
      maxPlayCount: options.maxPlayCount || 1000,
      ...options
    }
    
    // 播放历史
    this.history = []
    
    // 播放计数（用于统计最常播放）
    this.playCount = new Map()
  }

  /**
   * 初始化服务
   */
  async init() {
    if (this.isInitialized) return
    
    this.store = getPlayerStore()
    
    // 从本地存储恢复
    this.restore()
    
    this.isInitialized = true
    console.log('[HistoryService] Initialized')
  }

  /**
   * 添加播放记录
   * @param {Object} song - 歌曲对象
   * @param {Object} options - 选项
   * @param {number} options.playTime - 播放时长（秒）
   * @param {number} options.progress - 播放进度（0-1）
   * @param {boolean} options.completed - 是否完整播放
   */
  add(song, options = {}) {
    if (!song || !song.id) {
      console.warn('[HistoryService] Invalid song:', song)
      return
    }
    
    const { playTime = 0, progress = 0, completed = false } = options
    
    // 创建历史记录
    const record = {
      id: song.id,
      title: song.title || 'Unknown',
      artist: song.artist || 'Unknown Artist',
      filename: song.filename,
      cover: song.cover,
      duration: song.duration || 0,
      playTime: playTime,
      progress: progress,
      completed: completed,
      timestamp: Date.now(),
      date: new Date().toISOString()
    }
    
    // 移除已存在的相同歌曲记录
    this.history = this.history.filter(h => h.id !== song.id)
    
    // 添加到开头
    this.history.unshift(record)
    
    // 限制历史记录数量
    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(0, this.config.maxHistorySize)
    }
    
    // 更新播放计数
    this.incrementPlayCount(song.id)
    
    // 同步到状态存储
    if (this.store) {
      this.store.mutations.addToHistory(song, playTime)
    }
    
    // 持久化
    this.persist()
    
    console.log('[HistoryService] Added to history:', song.title)
  }

  /**
   * 增加播放计数
   * @param {number} songId - 歌曲ID
   */
  incrementPlayCount(songId) {
    const current = this.playCount.get(songId) || 0
    this.playCount.set(songId, current + 1)
    
    // 限制播放计数大小
    if (this.playCount.size > this.config.maxPlayCount) {
      // 删除最早的记录
      const firstKey = this.playCount.keys().next().value
      this.playCount.delete(firstKey)
    }
    
    // 持久化播放计数
    this.persistPlayCount()
  }

  /**
   * 获取播放计数
   * @param {number} songId - 歌曲ID
   * @returns {number} 播放次数
   */
  getPlayCount(songId) {
    return this.playCount.get(songId) || 0
  }

  /**
   * 获取最近播放
   * @param {number} limit - 数量限制
   * @returns {Array} 最近播放记录
   */
  getRecent(limit = 10) {
    return this.history.slice(0, limit)
  }

  /**
   * 获取最常播放
   * @param {number} limit - 数量限制
   * @returns {Array} 最常播放记录
   */
  getMostPlayed(limit = 10) {
    // 将播放计数转换为数组并排序
    const sorted = Array.from(this.playCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
    
    // 获取完整的歌曲信息
    return sorted.map(([id, count]) => {
      const historyRecord = this.history.find(h => h.id === id)
      return {
        id,
        count,
        ...historyRecord
      }
    }).filter(item => item.title) // 过滤掉没有历史记录的歌曲
  }

  /**
   * 获取播放统计
   * @returns {Object} 统计信息
   */
  getStats() {
    const totalPlays = Array.from(this.playCount.values()).reduce((sum, count) => sum + count, 0)
    const totalPlayTime = this.history.reduce((sum, record) => sum + (record.playTime || 0), 0)
    
    // 计算今日播放
    const today = new Date().toDateString()
    const todayPlays = this.history.filter(h => new Date(h.timestamp).toDateString() === today).length
    
    // 计算本周播放
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const weekPlays = this.history.filter(h => h.timestamp > weekAgo).length
    
    return {
      totalSongs: this.history.length,
      totalPlays: totalPlays,
      totalPlayTime: totalPlayTime,
      todayPlays: todayPlays,
      weekPlays: weekPlays,
      uniqueSongs: this.playCount.size
    }
  }

  /**
   * 获取某一天的播放记录
   * @param {Date} date - 日期
   * @returns {Array} 播放记录
   */
  getByDate(date) {
    const targetDate = new Date(date).toDateString()
    return this.history.filter(h => new Date(h.timestamp).toDateString() === targetDate)
  }

  /**
   * 获取某段时间的播放记录
   * @param {Date} startDate - 开始日期
   * @param {Date} endDate - 结束日期
   * @returns {Array} 播放记录
   */
  getByDateRange(startDate, endDate) {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime()
    
    return this.history.filter(h => h.timestamp >= start && h.timestamp <= end)
  }

  /**
   * 搜索历史记录
   * @param {string} keyword - 搜索关键词
   * @returns {Array} 搜索结果
   */
  search(keyword) {
    if (!keyword || !keyword.trim()) {
      return this.history
    }
    
    const query = keyword.toLowerCase().trim()
    
    return this.history.filter(record => {
      const titleMatch = record.title && record.title.toLowerCase().includes(query)
      const artistMatch = record.artist && record.artist.toLowerCase().includes(query)
      return titleMatch || artistMatch
    })
  }

  /**
   * 检查是否播放过
   * @param {number} songId - 歌曲ID
   * @returns {boolean}
   */
  hasPlayed(songId) {
    return this.history.some(h => h.id === songId)
  }

  /**
   * 获取上次播放进度
   * @param {number} songId - 歌曲ID
   * @returns {number} 播放进度（秒），0表示没有记录
   */
  getLastProgress(songId) {
    const record = this.history.find(h => h.id === songId)
    return record ? (record.playTime || 0) : 0
  }

  /**
   * 清除历史记录
   * @param {Object} options - 选项
   * @param {boolean} options.keepCount - 是否保留播放计数
   */
  clear(options = {}) {
    const { keepCount = false } = options
    
    this.history = []
    
    if (!keepCount) {
      this.playCount.clear()
    }
    
    // 持久化
    this.persist()
    if (!keepCount) {
      this.persistPlayCount()
    }
    
    console.log('[HistoryService] History cleared')
  }

  /**
   * 删除单条记录
   * @param {number} songId - 歌曲ID
   */
  remove(songId) {
    this.history = this.history.filter(h => h.id !== songId)
    this.playCount.delete(songId)
    
    this.persist()
    this.persistPlayCount()
    
    console.log('[HistoryService] Removed from history:', songId)
  }

  /**
   * 持久化到本地存储
   */
  persist() {
    StorageUtils.set(PlayerStorageKeys.HISTORY, this.history)
  }

  /**
   * 持久化播放计数
   */
  persistPlayCount() {
    const countObj = Object.fromEntries(this.playCount)
    StorageUtils.set('player_playCount', countObj)
  }

  /**
   * 从本地存储恢复
   */
  restore() {
    // 恢复历史记录
    const savedHistory = StorageUtils.get(PlayerStorageKeys.HISTORY, [])
    if (Array.isArray(savedHistory)) {
      this.history = savedHistory
    }
    
    // 恢复播放计数
    const savedCount = StorageUtils.get('player_playCount', {})
    if (savedCount && typeof savedCount === 'object') {
      this.playCount = new Map(Object.entries(savedCount).map(([k, v]) => [parseInt(k), v]))
    }
    
    console.log('[HistoryService] Restored from storage:', this.history.length, 'records')
  }

  /**
   * 导出历史记录
   * @returns {Object} 历史数据
   */
  export() {
    return {
      history: this.history,
      playCount: Object.fromEntries(this.playCount),
      exportDate: new Date().toISOString(),
      version: '1.0'
    }
  }

  /**
   * 导入历史记录
   * @param {Object} data - 历史数据
   */
  import(data) {
    if (!data || !Array.isArray(data.history)) {
      console.error('[HistoryService] Invalid import data')
      return false
    }
    
    // 合并历史记录
    const existingIds = new Set(this.history.map(h => h.id))
    const newRecords = data.history.filter(h => !existingIds.has(h.id))
    
    this.history = [...this.history, ...newRecords]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.config.maxHistorySize)
    
    // 合并播放计数
    if (data.playCount && typeof data.playCount === 'object') {
      for (const [id, count] of Object.entries(data.playCount)) {
        const current = this.playCount.get(parseInt(id)) || 0
        this.playCount.set(parseInt(id), current + count)
      }
    }
    
    // 持久化
    this.persist()
    this.persistPlayCount()
    
    console.log('[HistoryService] Imported', newRecords.length, 'records')
    return true
  }
}

// 单例模式
let historyServiceInstance = null

function createHistoryService(options = {}) {
  if (!historyServiceInstance) {
    historyServiceInstance = new HistoryService(options)
  }
  return historyServiceInstance
}

function getHistoryService() {
  return createHistoryService()
}

export { HistoryService, createHistoryService, getHistoryService }
export default HistoryService
