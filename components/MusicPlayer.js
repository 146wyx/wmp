// API 基础 URL 配置
const API_BASE_URL = ''

export default {
  name: 'MusicPlayer',
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
    const { ref, computed, onMounted, onUnmounted, watch } = window.Vue

    // 监听 favorites 变化
    watch(() => props.favorites, (newVal) => {
      console.log('MusicPlayer favorites changed:', newVal)
    }, { immediate: true, deep: true })

    // 计算属性：收藏列表
    const favorites = computed(() => props.favorites || [])

    // 播放列表数据
    const playlist = ref([])
    const isLoading = ref(false)
    const lyrics = ref([])
    const searchQuery = ref('')

    // 播放器状态
    const currentIndex = ref(0)
    const isPlaying = ref(false)
    const currentTime = ref(0)
    const duration = ref(0)
    const volume = ref(0.7)
    const playMode = ref('sequence') // sequence, random, single
    const isMuted = ref(false)
    const isDragging = ref(false)
    const isVolumeDragging = ref(false)
    const isAudioReady = ref(false)
    const showPlaylist = ref(true)
    const audioRef = ref(null)
    const autoPlayBlocked = ref(false)  // 自动播放被阻止标志
    const showUserMenu = ref(false)  // 用户菜单显示状态

    // 右键菜单状态
    const contextMenu = ref({
      show: false,
      x: 0,
      y: 0,
      song: null,
      songIndex: -1
    })

    // 计算属性
    const currentSong = computed(() => playlist.value[currentIndex.value] || {})
    const progressPercent = computed(() => {
      if (duration.value === 0) return 0
      return (currentTime.value / duration.value) * 100
    })

    // 过滤后的播放列表
    const filteredPlaylist = computed(() => {
      if (!searchQuery.value.trim()) return playlist.value
      const query = searchQuery.value.toLowerCase().trim()
      return playlist.value.filter(song => 
        (song.title && song.title.toLowerCase().includes(query)) ||
        (song.artist && song.artist.toLowerCase().includes(query)) ||
        (song.album && song.album.toLowerCase().includes(query))
      )
    })

    // 使用白色作为默认封面
    const getDefaultCover = () => {
      return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23ffffff"/%3E%3C/svg%3E'
    }

    // 加载音乐列表
    const loadMusicList = async () => {
      isLoading.value = true
      try {
        const response = await fetch(`${API_BASE_URL}/api/music-list`)
        const result = await response.json()

        if (result.success && result.data.length > 0) {
          playlist.value = result.data.map((item, index) => ({
            id: index + 1,
            title: item.title,
            artist: item.artist,
            album: item.album,
            cover: item.coverUrl || getDefaultCover(),
            url: item.url,
            filename: item.filename,
            hasLyrics: item.hasLyrics,
            lrcUrl: item.lrcUrl,
            hasCover: item.hasCover,
            coverUrl: item.coverUrl,
            duration: item.duration || 0
          }))
        } else if (playlist.value.length === 0) {
          // 如果没有本地音乐，显示空状态
          playlist.value = []
        }
        
        // 加载第一首歌的歌词（如果有）
        if (playlist.value.length > 0 && playlist.value[0].hasLyrics) {
          await loadLyrics(playlist.value[0])
        }
      } catch (error) {
        console.error('加载音乐列表失败:', error)
      } finally {
        isLoading.value = false
      }
    }

    // 歌词格式配置 - 可扩展支持更多格式
    const lyricFormats = [
      {
        name: 'standard',
        // 标准格式: [mm:ss.xx] 或 [mm:ss:xx]
        regex: /\[(\d{1,2})[:：](\d{2})[:\.](\d{1,6})\]/g,
        hasMs: true
      },
      {
        name: 'no_ms',
        // 无毫秒: [mm:ss]
        regex: /\[(\d{1,2})[:：](\d{2})\](?![:\.\d])/g,
        hasMs: false
      },
      {
        name: 'bracket_colon',
        // 冒号分隔: [mm:ss:xx]
        regex: /\[(\d{1,2})[:：](\d{2}):(\d{1,6})\]/g,
        hasMs: true
      }
    ]

    // 自动检测歌词格式
    const detectLyricFormat = (lrcText) => {
      const sampleLines = lrcText.split('\n').slice(0, 10)
      let bestFormat = null
      let maxMatches = 0
      
      for (const format of lyricFormats) {
        let matchCount = 0
        for (const line of sampleLines) {
          const matches = line.match(format.regex)
          if (matches) matchCount += matches.length
        }
        if (matchCount > maxMatches) {
          maxMatches = matchCount
          bestFormat = format
        }
      }
      
      return bestFormat || lyricFormats[0]
    }

    // 判断文本是否为中文
    const isChinese = (text) => {
      return /[\u4e00-\u9fa5]/.test(text)
    }

    // 解析 LRC 歌词 - 自动检测格式，支持双语合并
    const parseLyrics = (lrcText) => {
      if (!lrcText) return []
      
      const lines = lrcText.split('\n')
      const parsed = []
      
      // 检测歌词格式
      const detectedFormat = detectLyricFormat(lrcText)
      console.log(`[Lyrics] Detected format: ${detectedFormat?.name || 'unknown'}`)
      
      // 使用所有格式进行匹配，确保兼容性
      const allRegexes = lyricFormats.map(f => f.regex)
      
      lines.forEach(line => {
        let timeMatches = []
        
        // 尝试所有格式
        for (const regex of allRegexes) {
          const matches = [...line.matchAll(regex)]
          timeMatches = timeMatches.concat(matches)
        }
        
        // 按匹配位置排序
        timeMatches.sort((a, b) => a.index - b.index)
        
        // 去重（同一位置只保留一个）
        const uniqueMatches = []
        let lastIndex = -1
        timeMatches.forEach(match => {
          if (match.index !== lastIndex) {
            uniqueMatches.push(match)
            lastIndex = match.index
          }
        })
        
        if (uniqueMatches.length > 0) {
          // 获取最后一个时间标签后的文本
          const lastMatch = uniqueMatches[uniqueMatches.length - 1]
          const textStartIndex = lastMatch.index + lastMatch[0].length
          const text = line.substring(textStartIndex).trim()
          
          // 只有当前行有文本内容时才添加歌词
          // 这样可以跳过空行，但保留有时间标签的行
          if (text || uniqueMatches.length === 1) {
            // 为每个时间标签创建一个歌词条目
            uniqueMatches.forEach(match => {
              const minutes = parseInt(match[1])
              const seconds = parseInt(match[2])
              // 处理毫秒部分
              let milliseconds = 0
              if (match[3]) {
                const msStr = match[3].padEnd(3, '0').substring(0, 3)
                milliseconds = parseInt(msStr)
              }
              const time = minutes * 60 + seconds + milliseconds / 1000
              
              // 如果有文本就用文本，否则用空字符串
              parsed.push({ time, text: text || '', isChinese: isChinese(text) })
            })
          }
        }
      })
      
      // 按时间排序
      const sortedLyrics = parsed.sort((a, b) => a.time - b.time)
      
      // 合并歌词：按顺序遍历，原文和后面的翻译配对
      const mergedLyrics = []
      let i = 0
      
      while (i < sortedLyrics.length) {
        const current = sortedLyrics[i]
        const next = sortedLyrics[i + 1]
        
        // 如果当前是原文，下一个是翻译，配对
        if (next && !current.isChinese && next.isChinese) {
          mergedLyrics.push({
            time: current.time,   // 使用原文的时间戳
            text: next.text,      // 翻译
            textEn: current.text  // 原文
          })
          i += 2
        }
        // 如果当前是翻译，下一个是原文，配对（使用原文的时间）
        else if (next && current.isChinese && !next.isChinese) {
          mergedLyrics.push({
            time: next.time,      // 使用原文的时间戳
            text: current.text,   // 翻译
            textEn: next.text     // 原文
          })
          i += 2
        }
        // 单行，无法配对
        else {
          mergedLyrics.push({
            time: current.time,
            text: current.isChinese ? current.text : '',
            textEn: current.isChinese ? '' : current.text
          })
          i += 1
        }
      }
      
      return mergedLyrics
    }

    // 加载歌词
    const loadLyrics = async (song = null) => {
      const targetSong = song || currentSong.value
      if (!targetSong || !targetSong.hasLyrics || !targetSong.lrcUrl) {
        lyrics.value = []
        return
      }

      try {
        // 从 lrcUrl 中提取文件名
        const lrcUrl = targetSong.lrcUrl
        const filename = lrcUrl.split('/').pop()
        const response = await fetch(`/api/lyrics/${filename}`)
        const result = await response.json()

        if (result.success) {
          lyrics.value = parseLyrics(result.data)
          // 歌词加载完成后更新媒体会话
          updateMediaSessionLyrics()
        } else {
          lyrics.value = []
        }
      } catch (error) {
        console.error('加载歌词失败:', error)
        lyrics.value = []
      }
    }

    // 获取当前歌词行索引
    const currentLyricIndex = computed(() => {
      if (!lyrics.value || lyrics.value.length === 0) return -1
      
      const current = currentTime.value
      for (let i = lyrics.value.length - 1; i >= 0; i--) {
        if (lyrics.value[i].time <= current) {
          return i
        }
      }
      return -1
    })

    // 歌词容器样式 - 当前歌词始终保持在中间偏上
    const lyricsContainerStyle = computed(() => {
      const containerHeight = 180
      const centerOffset = containerHeight / 2 - 20 - 40 - 10 // 向上偏移一行+10px
      
      // 计算当前索引之前所有行的高度总和
      let offsetBefore = 0
      for (let i = 0; i < currentLyricIndex.value && i < lyrics.value.length; i++) {
        offsetBefore += lyrics.value[i].textEn ? 64 : 40
      }
      
      const offset = centerOffset - offsetBefore
      return {
        transform: 'translateY(' + offset + 'px)'
      }
    })

    // 格式化时间
    const formatTime = (time) => {
      if (!time || isNaN(time)) return '0:00'
      const minutes = Math.floor(time / 60)
      const seconds = Math.floor(time % 60)
      return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    // 播放/暂停
    // 更新播放状态
    const updateMediaSessionState = () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused'
      }
    }

    const togglePlay = async () => {
      if (!audioRef.value) return
      if (isPlaying.value) {
        audioRef.value.pause()
        isPlaying.value = false
        autoPlayBlocked.value = false
      } else {
        try {
          await audioRef.value.play()
          isPlaying.value = true
          autoPlayBlocked.value = false
          // 如果是首次播放，设置媒体会话
          const song = currentSong.value
          if (song && !navigator.mediaSession.metadata) {
            setupMediaSession(song)
          }
        } catch (error) {
          console.error('播放失败:', error)
          isPlaying.value = false
          autoPlayBlocked.value = true
        }
      }
      updateMediaSessionState()
    }

    // 判断歌曲是否为英文歌（根据歌曲名或歌词内容判断）
    const isEnglishSong = () => {
      const song = currentSong.value
      if (!song) return false
      
      // 如果歌曲名包含大量英文字母，认为是英文歌
      const title = song.title || ''
      const englishChars = title.replace(/[^a-zA-Z]/g, '').length
      const totalChars = title.replace(/\s/g, '').length
      if (totalChars > 0 && englishChars / totalChars > 0.5) {
        return true
      }
      
      // 检查歌词，如果第一行是英文，认为是英文歌
      if (lyrics.value && lyrics.value.length > 0) {
        const firstLine = lyrics.value[0]
        // 如果第一行有英文歌词且没有中文歌词
        if (firstLine.textEn && !firstLine.text) {
          return true
        }
      }
      
      return false
    }

    // 获取当前歌词文本
    const getCurrentLyricText = () => {
      if (!lyrics.value || lyrics.value.length === 0) return ''
      const index = currentLyricIndex.value
      if (index >= 0 && index < lyrics.value.length) {
        const line = lyrics.value[index]
        // 英文歌优先显示英文，中文歌优先显示中文
        if (isEnglishSong()) {
          return line.textEn || line.text || ''
        }
        return line.text || line.textEn || ''
      }
      return ''
    }

    // 更新媒体会话的歌词信息
    const updateMediaSessionLyrics = () => {
      if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
        const lyricText = getCurrentLyricText()
        const song = currentSong.value
        if (song) {
          // 当有歌词时，标题显示：歌曲名 - 歌手，艺术家显示歌词
          if (lyricText) {
            navigator.mediaSession.metadata.title = `${song.title || '未知歌曲'} - ${song.artist || '未知艺术家'}`
            navigator.mediaSession.metadata.artist = lyricText
          } else {
            navigator.mediaSession.metadata.title = song.title || '未知歌曲'
            navigator.mediaSession.metadata.artist = song.artist || '未知艺术家'
          }
        }
      }
    }

    // 设置媒体会话信息（用于手机控制中心显示）
    const setupMediaSession = (song) => {
      if ('mediaSession' in navigator) {
        const lyricText = getCurrentLyricText()
        
        // 构建 artwork，确保图片 URL 是完整的
        let artwork = []
        if (song.cover) {
          const coverUrl = song.cover.startsWith('http') 
            ? song.cover 
            : window.location.origin + song.cover
          artwork = [
            { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
            { src: coverUrl, sizes: '128x128', type: 'image/jpeg' },
            { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
            { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: coverUrl, sizes: '384x384', type: 'image/jpeg' },
            { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
          ]
        }
        
        try {
          // 当有歌词时，标题显示：歌曲名 - 歌手，艺术家显示歌词
          // 当没有歌词时，标题显示歌曲名，艺术家显示歌手
          const title = lyricText 
            ? `${song.title || '未知歌曲'} - ${song.artist || '未知艺术家'}`
            : (song.title || '未知歌曲')
          const artist = lyricText ? lyricText : (song.artist || '未知艺术家')
          
          navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: song.album || '',
            artwork: artwork
          })
          
          // iOS 需要显式设置播放状态
          navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused'
        } catch (e) {
          console.error('MediaSession 设置失败:', e)
        }

        // 设置媒体控制动作
        navigator.mediaSession.setActionHandler('play', () => {
          togglePlay()
        })
        navigator.mediaSession.setActionHandler('pause', () => {
          togglePlay()
        })
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          prevSong()
        })
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          nextSong()
        })
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          // 手机控制中心快退按钮改为上一首
          prevSong()
        })
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          // 手机控制中心快进按钮改为下一首
          nextSong()
        })
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (audioRef.value && details.seekTime) {
            audioRef.value.currentTime = details.seekTime
          }
        })
      }
    }

    // 是否是首次加载（页面刷新后）
    let isFirstLoad = true

    // 播放指定歌曲
    const playSong = async (index) => {
      currentIndex.value = index
      currentTime.value = 0
      lyrics.value = []

      const song = playlist.value[index]

      if (audioRef.value) {
        audioRef.value.load()
        // 音频加载开始时重置状态
        audioRef.value.onloadstart = () => {
          isAudioReady.value = false
        }
        
        // 等待音频加载完成
        audioRef.value.oncanplay = async () => {
          isAudioReady.value = true
          
          // 设置媒体会话（即使不自动播放也要设置，这样控制中心能显示信息）
          if (song) {
            setupMediaSession(song)
          }
          
          // 首次加载（页面刷新）不自动播放，其他情况自动播放
          if (!isFirstLoad) {
            try {
              await audioRef.value.play()
              isPlaying.value = true
              autoPlayBlocked.value = false
              updateMediaSessionState()
            } catch (error) {
              console.error('自动播放失败:', error)
              // 浏览器阻止了自动播放
              if (error.name === 'NotAllowedError') {
                autoPlayBlocked.value = true
                isPlaying.value = false
                console.log('自动播放被阻止，等待用户点击播放')
              }
              updateMediaSessionState()
            }
          } else {
            // 首次加载，标记为已完成，不自动播放
            isFirstLoad = false
            // 设置媒体会话但不播放
            updateMediaSessionState()
          }
        }
        
        // 异步加载歌词，不阻塞播放
        if (song && song.hasLyrics) {
          loadLyrics(song).catch(err => {
            console.error('歌词加载失败:', err)
          })
        }
      }
    }

    // 上一首
    const prevSong = () => {
      if (playlist.value.length === 0) return
      let newIndex
      if (playMode.value === 'random') {
        newIndex = Math.floor(Math.random() * playlist.value.length)
      } else {
        newIndex = currentIndex.value === 0
          ? playlist.value.length - 1
          : currentIndex.value - 1
      }
      playSong(newIndex)
    }

    // 下一首
    const nextSong = () => {
      if (playlist.value.length === 0) return
      let newIndex
      if (playMode.value === 'random') {
        newIndex = Math.floor(Math.random() * playlist.value.length)
      } else {
        newIndex = currentIndex.value === playlist.value.length - 1
          ? 0
          : currentIndex.value + 1
      }
      playSong(newIndex)
    }

    // 切换播放模式
    const togglePlayMode = () => {
      const modes = ['sequence', 'random', 'single']
      const currentModeIndex = modes.indexOf(playMode.value)
      playMode.value = modes[(currentModeIndex + 1) % modes.length]
    }

    // 获取播放模式图标
    const getPlayModeIcon = () => {
      const icons = {
        sequence: 'fa-arrow-down-a-z',
        random: 'fa-shuffle',
        single: 'fa-repeat'
      }
      return icons[playMode.value] || icons.sequence
    }

    // 获取播放模式文本
    const getPlayModeText = () => {
      const texts = {
        sequence: '顺序播放',
        random: '随机播放',
        single: '单曲循环'
      }
      return texts[playMode.value] || '顺序播放'
    }

    // 进度条拖动
    const seek = (event) => {
      if (!audioRef.value || !duration.value || duration.value === 0 || !isAudioReady.value) return
      const rect = event.currentTarget.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const newTime = percent * duration.value
      // 确保时间在有效范围内
      if (newTime >= 0 && newTime <= duration.value) {
        audioRef.value.currentTime = newTime
        currentTime.value = newTime
      }
    }

    // 开始拖动
    const startDrag = (event) => {
      isDragging.value = true
      seek(event)
      document.addEventListener('mousemove', onDrag)
      document.addEventListener('mouseup', stopDrag)
    }

    // 拖动中
    const onDrag = (event) => {
      if (!isDragging.value) return
      const progressBar = document.querySelector('.progress-bar')
      if (!progressBar) return
      const rect = progressBar.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      currentTime.value = percent * duration.value
    }

    // 停止拖动
    const stopDrag = (event) => {
      if (isDragging.value && audioRef.value && duration.value && isAudioReady.value) {
        // 使用最终位置计算时间
        const progressBar = document.querySelector('.progress-bar')
        if (progressBar) {
          const rect = progressBar.getBoundingClientRect()
          const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
          const finalTime = percent * duration.value
          audioRef.value.currentTime = finalTime
          currentTime.value = finalTime
        }
      }
      isDragging.value = false
      document.removeEventListener('mousemove', onDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    // 音量控制
    const setVolume = (event) => {
      if (!audioRef.value) return
      const volumeBar = event.currentTarget || document.querySelector('.volume-bar')
      if (!volumeBar) return
      const rect = volumeBar.getBoundingClientRect()
      const percent = (event.clientX - rect.left) / rect.width
      const newVolume = Math.max(0, Math.min(1, percent))
      volume.value = newVolume
      audioRef.value.volume = newVolume
      isMuted.value = newVolume === 0
    }

    // 开始拖动音量
    const startVolumeDrag = (event) => {
      isVolumeDragging.value = true
      setVolume(event)
      document.addEventListener('mousemove', onVolumeDrag)
      document.addEventListener('mouseup', stopVolumeDrag)
    }

    // 音量拖动中
    const onVolumeDrag = (event) => {
      if (!isVolumeDragging.value) return
      const volumeBar = document.querySelector('.volume-bar')
      if (!volumeBar) return
      const rect = volumeBar.getBoundingClientRect()
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const newVolume = percent
      volume.value = newVolume
      if (audioRef.value) {
        audioRef.value.volume = newVolume
      }
      isMuted.value = newVolume === 0
    }

    // 停止拖动音量
    const stopVolumeDrag = () => {
      isVolumeDragging.value = false
      document.removeEventListener('mousemove', onVolumeDrag)
      document.removeEventListener('mouseup', stopVolumeDrag)
    }

    // 静音切换
    const toggleMute = () => {
      if (!audioRef.value) return
      if (isMuted.value) {
        audioRef.value.volume = volume.value || 0.7
        isMuted.value = false
      } else {
        audioRef.value.volume = 0
        isMuted.value = true
      }
    }

    // 音频事件处理
    const onTimeUpdate = () => {
      // 拖动时不更新进度，避免回弹
      if (audioRef.value && !isDragging.value) {
        currentTime.value = audioRef.value.currentTime
        // 更新歌词到媒体会话
        updateMediaSessionLyrics()
      }
    }

    const onLoadedMetadata = () => {
      if (audioRef.value) {
        duration.value = audioRef.value.duration
      }
    }

    const onEnded = () => {
      if (playMode.value === 'single') {
        audioRef.value.currentTime = 0
        audioRef.value.play()
      } else {
        nextSong()
      }
    }

    // 键盘快捷键
    const handleKeydown = (e) => {
      // 如果搜索框获得焦点，不执行任何快捷键操作
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        prevSong()
      } else if (e.code === 'ArrowRight') {
        nextSong()
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        volume.value = Math.min(1, volume.value + 0.1)
        if (audioRef.value) audioRef.value.volume = volume.value
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        volume.value = Math.max(0, volume.value - 0.1)
        if (audioRef.value) audioRef.value.volume = volume.value
      }
    }

    // 处理页面可见性变化
    const handleVisibilityChange = () => {
      if (!document.hidden && isPlaying.value && currentSong.value) {
        // 页面重新可见时，重新设置 Media Session
        setupMediaSession(currentSong.value)
      }
    }

    // 显示右键菜单
    const showContextMenu = (event, song, index) => {
      event.preventDefault()
      contextMenu.value = {
        show: true,
        x: event.clientX,
        y: event.clientY,
        song: song,
        songIndex: index
      }
    }

    // 隐藏右键菜单
    const hideContextMenu = () => {
      contextMenu.value.show = false
    }

    // 处理右键菜单点击
    const handleContextMenuAction = (action) => {
      const song = contextMenu.value.song
      const index = contextMenu.value.songIndex

      if (!song || index === -1) return

      switch (action) {
        case 'play':
          playSong(index)
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

    onMounted(() => {
      document.addEventListener('keydown', handleKeydown)
      document.addEventListener('visibilitychange', handleVisibilityChange)
      document.addEventListener('click', hideContextMenu)
      loadMusicList()
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('click', hideContextMenu)
    })

    return {
      playlist,
      isLoading,
      lyrics,
      currentIndex,
      isPlaying,
      currentTime,
      duration,
      volume,
      playMode,
      isMuted,
      isDragging,
      isAudioReady,
      autoPlayBlocked,
      showPlaylist,
      showUserMenu,
      contextMenu,
      audioRef,
      currentSong,
      progressPercent,
      currentLyricIndex,
      lyricsContainerStyle,
      searchQuery,
      filteredPlaylist,
      favorites,
      formatTime,
      togglePlay,
      playSong,
      prevSong,
      nextSong,
      togglePlayMode,
      getPlayModeIcon,
      getPlayModeText,
      seek,
      startDrag,
      setVolume,
      startVolumeDrag,
      toggleMute,
      showContextMenu,
      hideContextMenu,
      handleContextMenuAction,
      onTimeUpdate,
      onLoadedMetadata,
      onEnded,
      loadMusicList
    }
  },
  template: `
    <div class="music-player">
      <!-- 音频元素 -->
      <audio
        ref="audioRef"
        :src="currentSong.url"
        crossorigin="anonymous"
        preload="metadata"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoadedMetadata"
        @ended="onEnded"
      ></audio>

      <!-- 主播放器区域 -->
      <div class="player-main">
        <!-- 歌曲信息 -->
        <div class="song-info">
          <div class="album-cover" :class="{ 'playing': isPlaying }">
            <img :src="currentSong.cover" :alt="currentSong.title" draggable="false">
          </div>
          <div class="song-details">
            <h2 class="song-title">{{ currentSong.title || '未选择歌曲' }}</h2>
            <p class="song-artist">{{ currentSong.artist || '-' }}</p>
          </div>
        </div>

        <!-- 歌词显示 - 直接显示在歌曲信息下方 -->
        <div class="lyrics-panel" v-if="currentSong.hasLyrics && lyrics && lyrics.length > 0" ref="lyricsPanel">
          <div class="lyrics-container" :style="lyricsContainerStyle">
            <div
              v-for="(line, index) in lyrics"
              :key="index"
              class="lyric-line"
              :class="{ 'active': index === currentLyricIndex, 'bilingual': line.textEn }"
            >
              <div v-if="line.textEn" class="lyric-en">{{ line.textEn }}</div>
              <div class="lyric-text">{{ line.text }}</div>
            </div>
          </div>
        </div>

        <!-- 进度条 -->
        <div class="progress-section">
          <div class="time-display">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
          <div class="progress-bar" @mousedown="startDrag">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            <div class="progress-handle" :style="{ left: progressPercent + '%' }" :class="{ 'dragging': isDragging }"></div>
          </div>
        </div>

        <!-- 控制按钮 -->
        <div class="controls">
          <button
            class="control-btn mode-btn"
            @click="togglePlayMode"
            :title="getPlayModeText()"
          >
            <i :class="['fas', getPlayModeIcon()]"></i>
          </button>

          <button class="control-btn" @click="prevSong">
            <i class="fas fa-step-backward"></i>
          </button>

          <button class="control-btn play-btn" @click="togglePlay" :class="{ 'blocked': autoPlayBlocked }">
            <i :class="['fas', isPlaying ? 'fa-pause' : 'fa-play']"></i>
            <span v-if="autoPlayBlocked" class="play-hint">点击播放</span>
          </button>

          <button class="control-btn" @click="nextSong">
            <i class="fas fa-step-forward"></i>
          </button>

          <button
            class="control-btn playlist-toggle"
            @click="showPlaylist = !showPlaylist"
            :class="{ 'active': showPlaylist }"
          >
            <i class="fas fa-list"></i>
          </button>
        </div>

        <!-- 音量控制 -->
        <div class="volume-section">
          <button class="volume-btn" @click="toggleMute">
            <i :class="['fas', isMuted || volume === 0 ? 'fa-volume-mute' : volume < 0.5 ? 'fa-volume-down' : 'fa-volume-up']"></i>
          </button>
          <div class="volume-bar" @mousedown="startVolumeDrag">
            <div class="volume-fill" :style="{ width: (isMuted ? 0 : volume) * 100 + '%' }"></div>
          </div>
        </div>

        <!-- 上传按钮 -->
        <button class="upload-trigger-btn" @click="$emit('open-upload')">
          <i class="fas fa-cloud-upload-alt"></i>
          上传音乐
        </button>
      </div>

      <!-- 播放列表和喜欢列表容器 -->
      <div class="playlist-wrapper">
        <!-- 播放列表 -->
        <div class="playlist" :class="{ 'show': showPlaylist }">
          <div class="playlist-header">
            <h3>播放列表</h3>
            <div class="playlist-actions">
              <!-- 登录按钮/用户菜单 -->
              <div v-if="!isLoggedIn" class="user-menu-container">
                <button
                  class="login-btn-small"
                  @click="$emit('open-login')"
                  title="登录"
                >
                  <i class="fas fa-user"></i>
                </button>
              </div>
              <div v-else class="user-menu-container">
                <button
                  class="login-btn-small logged-in"
                  @click="showUserMenu = !showUserMenu"
                  title="用户菜单"
                >
                  <i class="fas fa-user-check"></i>
                </button>
                <!-- 用户下拉菜单 -->
                <div v-if="showUserMenu" class="user-dropdown-menu">
                  <div class="user-info">
                    <i class="fas fa-user-circle"></i>
                    <span>{{ currentUser?.username || '用户' }}</span>
                  </div>
                  <div class="menu-divider"></div>
                  <button class="menu-item" @click="$emit('show-favorites'); showUserMenu = false">
                    <i class="fas fa-heart"></i>
                    我的收藏
                    <span v-if="favorites.length > 0" class="menu-badge">{{ favorites.length }}</span>
                  </button>
                  <button class="menu-item" @click="$emit('change-password'); showUserMenu = false">
                    <i class="fas fa-key"></i>
                    修改密码
                  </button>
                  <button class="menu-item logout" @click="$emit('logout'); showUserMenu = false">
                    <i class="fas fa-sign-out-alt"></i>
                    退出登录
                  </button>
                </div>
              </div>
            <button class="refresh-btn" @click="loadMusicList" title="刷新列表">
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
        <div class="playlist-items">
          <div v-if="playlist.length === 0" class="empty-playlist">
            <i class="fas fa-music"></i>
            <p>暂无音乐</p>
            <button class="upload-link" @click="$emit('open-upload')">
              点击上传音乐
            </button>
          </div>
          <div v-else-if="filteredPlaylist.length === 0" class="empty-playlist">
            <i class="fas fa-search"></i>
            <p>未找到匹配的歌曲</p>
            <button class="upload-link" @click="searchQuery = ''">
              清除搜索
            </button>
          </div>
          <div
            v-for="(song, index) in filteredPlaylist"
            :key="song.id"
            class="playlist-item"
            :class="{ 'active': currentIndex === playlist.indexOf(song) }"
            @click="playSong(playlist.indexOf(song))"
            @contextmenu="showContextMenu($event, song, playlist.indexOf(song))"
          >
            <div class="item-number">
              <span v-if="currentIndex === index && isPlaying">
                <i class="fas fa-volume-up"></i>
              </span>
              <span v-else-if="currentIndex === index && autoPlayBlocked">
                <i class="fas fa-play" style="color: var(--accent-color);"></i>
              </span>
              <span v-else>{{ index + 1 }}</span>
            </div>
            <img :src="song.cover" :alt="song.title" class="item-cover">
            <div class="item-info">
              <div class="item-title">
                {{ song.title }}
                <i v-if="song.hasLyrics" class="fas fa-align-left lyrics-icon" title="有歌词"></i>
              </div>
              <div class="item-artist">{{ song.artist }}</div>
            </div>
            <!-- 收藏按钮（仅登录显示） -->
            <button
              v-if="isLoggedIn"
              class="favorite-btn"
              :class="{ 'is-favorite': favorites && favorites.length > 0 && favorites.some(f => f && f.filename === song.filename) }"
              @click.stop="favorites && favorites.length > 0 && favorites.some(f => f && f.filename === song.filename) ? $emit('remove-favorite', song.filename) : $emit('add-favorite', song)"
              :title="favorites && favorites.length > 0 && favorites.some(f => f && f.filename === song.filename) ? '取消收藏' : '添加到收藏'"
            >
              <i :class="favorites && favorites.length > 0 && favorites.some(f => f && f.filename === song.filename) ? 'fas fa-heart' : 'far fa-heart'"></i>
            </button>
            <div class="item-duration">{{ formatTime(song.duration) }}</div>
          </div>
        </div>
      </div>

      <!-- 喜欢列表（仅登录可见，紧挨着播放列表） -->
      <div v-if="isLoggedIn" class="favorites-panel">
        <div class="favorites-panel-header">
          <h3><i class="fas fa-heart"></i> 喜欢列表</h3>
          <span v-if="favorites && favorites.length > 0" class="favorites-count">{{ favorites.length }}</span>
        </div>
        <div class="favorites-panel-content">
          <!-- 调试信息 -->
          <div style="color: #666; font-size: 10px; padding: 5px;">
            favorites: {{ favorites ? favorites.length : 'null' }}
          </div>
          <div v-if="favorites && favorites.length > 0" style="color: #0f0; font-size: 10px; padding: 5px;">
            有 {{ favorites.length }} 首收藏歌曲!
          </div>
          <div v-if="!favorites || favorites.length === 0" class="favorites-empty">
            <i class="far fa-heart"></i>
            <p>暂无喜欢的歌曲</p>
          </div>
          <div
            v-for="(song, index) in favorites"
            :key="song.filename"
            class="favorites-panel-item"
            @click="playSong(playlist.findIndex(p => p.filename === song.filename))"
          >
            <img :src="song.cover || song.coverUrl || '/data/Segment/default.jpg'" :alt="song.title" class="favorites-item-cover">
            <div class="favorites-item-info">
              <div class="favorites-item-title">{{ song.title }}</div>
              <div class="favorites-item-artist">{{ song.artist }}</div>
            </div>
            <button
              class="favorites-item-remove"
              @click.stop="$emit('remove-favorite', song.filename)"
              title="取消喜欢"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
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
          v-if="isLoggedIn && !favorites.some(f => f.filename === contextMenu.song?.filename)"
          class="context-menu-item"
          @click="handleContextMenuAction('addToFavorites')"
        >
          <i class="fas fa-heart"></i>
          <span>添加到收藏</span>
        </button>
        <button
          v-if="isLoggedIn && favorites.some(f => f.filename === contextMenu.song?.filename)"
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
