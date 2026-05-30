/**
 * StorageUtils - 本地存储工具类
 * 提供 localStorage 的封装，支持对象存储和过期时间
 */

const StorageUtils = {
  // 存储键前缀，避免与其他应用冲突
  PREFIX: 'wmp_',

  /**
   * 设置存储项
   * @param {string} key - 键名
   * @param {*} value - 值
   * @param {number} expireMinutes - 过期时间（分钟），0表示不过期
   */
  set(key, value, expireMinutes = 0) {
    try {
      const data = {
        value: value,
        timestamp: Date.now(),
        expire: expireMinutes > 0 ? expireMinutes * 60 * 1000 : 0
      }
      localStorage.setItem(this.PREFIX + key, JSON.stringify(data))
      return true
    } catch (e) {
      console.error('[StorageUtils] Set error:', e)
      return false
    }
  },

  /**
   * 获取存储项
   * @param {string} key - 键名
   * @param {*} defaultValue - 默认值
   * @returns {*} 存储的值或默认值
   */
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(this.PREFIX + key)
      if (!item) return defaultValue

      const data = JSON.parse(item)
      
      // 检查是否过期
      if (data.expire > 0 && Date.now() - data.timestamp > data.expire) {
        localStorage.removeItem(this.PREFIX + key)
        return defaultValue
      }
      
      return data.value
    } catch (e) {
      console.error('[StorageUtils] Get error:', e)
      return defaultValue
    }
  },

  /**
   * 移除存储项
   * @param {string} key - 键名
   */
  remove(key) {
    try {
      localStorage.removeItem(this.PREFIX + key)
      return true
    } catch (e) {
      console.error('[StorageUtils] Remove error:', e)
      return false
    }
  },

  /**
   * 清空所有存储（仅清空带前缀的）
   */
  clear() {
    try {
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.startsWith(this.PREFIX)) {
          localStorage.removeItem(key)
        }
      })
      return true
    } catch (e) {
      console.error('[StorageUtils] Clear error:', e)
      return false
    }
  },

  /**
   * 获取所有存储的键
   * @returns {string[]} 键名数组
   */
  keys() {
    try {
      return Object.keys(localStorage)
        .filter(key => key.startsWith(this.PREFIX))
        .map(key => key.substring(this.PREFIX.length))
    } catch (e) {
      console.error('[StorageUtils] Keys error:', e)
      return []
    }
  },

  /**
   * 检查是否存在
   * @param {string} key - 键名
   * @returns {boolean}
   */
  has(key) {
    return localStorage.getItem(this.PREFIX + key) !== null
  }
}

// 播放器专用的存储键
const PlayerStorageKeys = {
  VOLUME: 'player_volume',
  PLAY_MODE: 'player_playMode',
  CURRENT_SONG_ID: 'player_currentSongId',
  CURRENT_TIME: 'player_currentTime',
  HISTORY: 'player_history',
  QUEUE: 'player_queue',
  MUTED: 'player_muted'
}

export { StorageUtils, PlayerStorageKeys }
