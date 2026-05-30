/**
 * LyricsParser - 歌词解析器
 * 支持标准 LRC 格式和双语歌词
 */

class LyricsParser {
  /**
   * 解析单条时间标签 [mm:ss.xx]
   * @param {string} tag - 时间标签字符串
   * @returns {number|null} 时间（秒）
   */
  parseTimeTag(tag) {
    const match = tag.match(/\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/)
    if (!match) return null

    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    let milliseconds = parseInt(match[3], 10)

    // 处理两位数毫秒
    if (match[3].length === 2) {
      milliseconds *= 10
    }

    return minutes * 60 + seconds + milliseconds / 1000
  }

  /**
   * 检测文本语言类型
   * @param {string} text - 文本
   * @returns {string} 'cn' | 'kr' | 'en' | 'other'
   */
  detectLanguage(text) {
    if (/[\u4e00-\u9fa5]/.test(text)) return 'cn'  // 中文
    if (/[\uac00-\ud7af]/.test(text)) return 'kr'  // 韩文
    if (/[a-zA-Z]/.test(text)) return 'en'         // 英文
    return 'other'
  }

  /**
   * 解析 LRC 歌词内容
   * @param {string} lrcText - LRC 歌词文本
   * @returns {Array} 解析后的歌词数组 [{time, text, primary, secondary}, ...]
   */
  parse(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') {
      return []
    }

    const lines = lrcText.split('\n')
    const rawLyrics = []

    // 第一步：解析所有歌词行
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (!trimmedLine) continue

      // 匹配所有时间标签
      const timeTags = []
      const regex = /\[\d{1,2}:\d{2}\.\d{2,3}\]/g
      let match

      while ((match = regex.exec(trimmedLine)) !== null) {
        timeTags.push(match[0])
      }

      if (timeTags.length === 0) continue

      // 提取歌词文本（最后一个时间标签之后的内容）
      const lastTag = timeTags[timeTags.length - 1]
      const lastTagIndex = trimmedLine.lastIndexOf(lastTag)
      const text = trimmedLine.substring(lastTagIndex + lastTag.length).trim()

      // 为每个时间标签创建歌词对象
      for (const tag of timeTags) {
        const time = this.parseTimeTag(tag)
        if (time !== null) {
          const lang = this.detectLanguage(text)
          rawLyrics.push({
            time,
            text,
            lang
          })
        }
      }
    }

    // 按时间排序
    rawLyrics.sort((a, b) => a.time - b.time)

    // 第二步：按时间分组，相同时间戳的分为一组
    const timeGroups = new Map()
    const EXACT_THRESHOLD = 0.01 // 0.01秒内视为同一时间戳

    for (const item of rawLyrics) {
      // 查找是否已有接近的时间组
      let foundGroup = null
      for (const [key, group] of timeGroups) {
        if (Math.abs(group.time - item.time) <= EXACT_THRESHOLD) {
          foundGroup = group
          break
        }
      }

      if (foundGroup) {
        foundGroup.items.push(item)
      } else {
        const timeKey = item.time.toFixed(3)
        timeGroups.set(timeKey, {
          time: item.time,
          items: [item]
        })
      }
    }

    // 第三步：将时间组转换为数组并排序
    const sortedGroups = Array.from(timeGroups.values()).sort((a, b) => a.time - b.time)

    // 检测是否有双语歌词（同一时间戳有中文和非中文）
    let bilingualPairCount = 0
    for (const group of sortedGroups) {
      const hasCn = group.items.some(item => item.lang === 'cn')
      const hasNonCn = group.items.some(item => item.lang === 'en' || item.lang === 'kr')
      if (hasCn && hasNonCn) {
        bilingualPairCount++
      }
    }
    // 如果有至少3组双语歌词，认为是双语歌
    const isBilingualSong = bilingualPairCount >= 3
    console.log('[LyricsParser] Bilingual pairs:', bilingualPairCount, 'Is bilingual:', isBilingualSong)

    // 第四步：处理每个时间组
    const mergedLyrics = []

    if (!isBilingualSong) {
      // 单语歌：显示所有语言的歌词
      for (const group of sortedGroups) {
        const cnItems = group.items.filter(item => item.lang === 'cn')
        const nonCnItems = group.items.filter(item => item.lang !== 'cn')

        // 显示所有歌词行，不区分语言
        for (const item of group.items) {
          mergedLyrics.push({
            time: group.time,
            text: item.text,
            primary: item.text,
            secondary: ''
          })
        }
      }
    } else {
      // 双语歌：双语显示
      // 格式规则：
      // - 同一组内有原文+译文：原文是当前句，译文是前一句的
      // - 只有译文：属于前一句原文
      // - 只有原文：作为新的一句
      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i]
        const cnItems = group.items.filter(item => item.lang === 'cn')
        const nonCnItems = group.items.filter(item => item.lang !== 'cn')

        // 当前组的原文（非中文）
        const currentPrimary = nonCnItems.length > 0
          ? nonCnItems.map(item => item.text).join(' ')
          : ''

        // 当前组的译文（中文）
        const currentSecondary = cnItems.length > 0
          ? cnItems.map(item => item.text).join(' ')
          : ''

        if (currentPrimary && currentSecondary) {
          // 当前组同时有原文+译文
          // 译文给前一句，原文作为当前句
          if (mergedLyrics.length > 0 && !mergedLyrics[mergedLyrics.length - 1].secondary) {
            mergedLyrics[mergedLyrics.length - 1].secondary = currentSecondary
          }

          mergedLyrics.push({
            time: group.time,
            text: currentPrimary,
            primary: currentPrimary,
            secondary: ''
          })
        } else if (currentPrimary && !currentSecondary) {
          // 当前组只有原文
          mergedLyrics.push({
            time: group.time,
            text: currentPrimary,
            primary: currentPrimary,
            secondary: ''
          })
        } else if (!currentPrimary && currentSecondary) {
          // 当前组只有译文，给前一句
          if (mergedLyrics.length > 0) {
            mergedLyrics[mergedLyrics.length - 1].secondary = currentSecondary
          }
        }
      }
    }

    return mergedLyrics
  }

  /**
   * 查找当前时间对应的歌词索引
   * @param {Array} lyrics - 歌词数组
   * @param {number} currentTime - 当前时间（秒）
   * @returns {number} 歌词索引，如果没有找到返回 -1
   */
  findIndex(lyrics, currentTime) {
    if (!lyrics || lyrics.length === 0) return -1

    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (lyrics[i].time <= currentTime) {
        return i
      }
    }

    return -1
  }
}

export default LyricsParser
