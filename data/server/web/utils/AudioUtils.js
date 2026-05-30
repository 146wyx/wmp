/**
 * AudioUtils - 音频工具函数
 * 提供音频相关的工具函数和常量
 */

// 音频错误类型
const AudioErrorTypes = {
  NETWORK_ERROR: 'network_error',
  DECODE_ERROR: 'decode_error',
  SRC_NOT_SUPPORTED: 'src_not_supported',
  ABORTED: 'aborted',
  UNKNOWN: 'unknown'
}

// 播放模式
const PlayModes = {
  SEQUENCE: 'sequence',
  RANDOM: 'random',
  SINGLE: 'single',
  LOOP: 'loop'
}

// 播放模式配置
const PlayModeConfig = {
  [PlayModes.SEQUENCE]: {
    name: '顺序播放',
    icon: 'fa-arrow-down-a-z',
    description: '按列表顺序播放'
  },
  [PlayModes.RANDOM]: {
    name: '随机播放',
    icon: 'fa-shuffle',
    description: '随机选择歌曲'
  },
  [PlayModes.SINGLE]: {
    name: '单曲循环',
    icon: 'fa-repeat',
    description: '重复播放当前歌曲'
  },
  [PlayModes.LOOP]: {
    name: '列表循环',
    icon: 'fa-rotate',
    description: '循环播放整个列表'
  }
}

/**
 * 格式化时间（秒 -> mm:ss）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * 格式化时间（秒 -> mm:ss.ms）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串（带毫秒）
 */
function formatTimeWithMs(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00.00'
  
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

/**
 * 解析音频错误
 * @param {HTMLAudioElement} audio - 音频元素
 * @returns {Object} 错误信息对象
 */
function parseAudioError(audio) {
  if (!audio || !audio.error) {
    return { type: AudioErrorTypes.UNKNOWN, message: '未知错误' }
  }

  const error = audio.error
  let type = AudioErrorTypes.UNKNOWN
  let message = '未知错误'

  switch (error.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      type = AudioErrorTypes.NETWORK_ERROR
      message = '网络错误，无法加载音频文件'
      break
    case MediaError.MEDIA_ERR_DECODE:
      type = AudioErrorTypes.DECODE_ERROR
      message = '音频解码错误'
      break
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      type = AudioErrorTypes.SRC_NOT_SUPPORTED
      message = '不支持的音频格式'
      break
    case MediaError.MEDIA_ERR_ABORTED:
      type = AudioErrorTypes.ABORTED
      message = '加载被中断'
      break
  }

  return { type, message, code: error.code }
}

/**
 * 生成智能随机播放队列
 * @param {Array} playlist - 播放列表
 * @param {Array} history - 播放历史
 * @param {number} maxHistorySize - 最大历史记录数
 * @returns {Array} 随机排序后的队列
 */
function generateRandomQueue(playlist, history = [], maxHistorySize = 10) {
  if (!playlist || playlist.length === 0) return []
  if (playlist.length === 1) return [...playlist]

  // 获取最近播放的歌曲ID
  const recentIds = history
    .slice(0, maxHistorySize)
    .map(h => h.id || h.songId)
    .filter(id => id !== undefined)

  // 分离最近播放过的和未播放的
  const recent = playlist.filter(s => recentIds.includes(s.id))
  const available = playlist.filter(s => !recentIds.includes(s.id))

  // Fisher-Yates 洗牌算法
  function shuffle(array) {
    const arr = [...array]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  // 先播放未播放过的，再播放最近播放过的
  return [...shuffle(available), ...shuffle(recent)]
}

/**
 * 生成播放队列
 * @param {Array} playlist - 播放列表
 * @param {string} playMode - 播放模式
 * @param {Array} history - 播放历史
 * @returns {Array} 播放队列
 */
function generatePlayQueue(playlist, playMode, history = []) {
  if (!playlist || playlist.length === 0) return []

  switch (playMode) {
    case PlayModes.RANDOM:
      return generateRandomQueue(playlist, history)
    case PlayModes.SEQUENCE:
    case PlayModes.SINGLE:
    case PlayModes.LOOP:
    default:
      return [...playlist]
  }
}

/**
 * 获取下一首索引
 * @param {number} currentIndex - 当前索引
 * @param {number} total - 总数
 * @param {string} playMode - 播放模式
 * @returns {number} 下一首索引
 */
function getNextIndex(currentIndex, total, playMode) {
  if (total <= 1) return 0

  switch (playMode) {
    case PlayModes.RANDOM:
      // 随机模式由队列控制，这里简单返回下一个
      return (currentIndex + 1) % total
    case PlayModes.SINGLE:
      // 单曲循环返回当前索引
      return currentIndex
    case PlayModes.LOOP:
    case PlayModes.SEQUENCE:
    default:
      return (currentIndex + 1) % total
  }
}

/**
 * 获取上一首索引
 * @param {number} currentIndex - 当前索引
 * @param {number} total - 总数
 * @returns {number} 上一首索引
 */
function getPrevIndex(currentIndex, total) {
  if (total <= 1) return 0
  return currentIndex <= 0 ? total - 1 : currentIndex - 1
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(func, limit) {
  let inThrottle
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait) {
  let timeout
  return function(...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

/**
 * 预加载音频元数据
 * @param {string} url - 音频URL
 * @returns {Promise} 预加载Promise
 */
function preloadAudio(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    
    audio.onloadedmetadata = () => {
      resolve({
        duration: audio.duration,
        url: url
      })
    }
    
    audio.onerror = () => {
      reject(new Error(`Failed to preload: ${url}`))
    }
    
    audio.src = url
  })
}

export {
  AudioErrorTypes,
  PlayModes,
  PlayModeConfig,
  formatTime,
  formatTimeWithMs,
  parseAudioError,
  generateRandomQueue,
  generatePlayQueue,
  getNextIndex,
  getPrevIndex,
  throttle,
  debounce,
  preloadAudio
}
