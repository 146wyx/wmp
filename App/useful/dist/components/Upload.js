// API 基础 URL 配置
const API_BASE_URL = ''

export default {
  name: 'Upload',
  emits: ['files-uploaded', 'close'],
  setup(props, { emit }) {
    const { ref, reactive, computed } = window.Vue

    const dragOver = ref(false)
    const uploading = ref(false)
    const uploadProgress = ref(0)
    const uploadStatus = ref('')
    const uploadedFiles = ref([])

    const musicFiles = ref([])
    const lrcFiles = ref([])
    const coverFiles = ref([])

    const hasFiles = computed(() => musicFiles.value.length > 0 || lrcFiles.value.length > 0 || coverFiles.value.length > 0)

    const handleDragOver = (e) => {
      e.preventDefault()
      dragOver.value = true
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      dragOver.value = false
    }

    const handleDrop = async (e) => {
      e.preventDefault()
      dragOver.value = false
      
      const items = e.dataTransfer.items
      const files = []
      
      if (items) {
        // 使用 DataTransferItemList 来支持文件夹
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry()
            if (entry) {
              await traverseFileTree(entry, files)
            }
          }
        }
      } else {
        // 回退到普通文件列表
        files.push(...Array.from(e.dataTransfer.files))
      }
      
      processFiles(files)
    }
    
    // 递归遍历文件夹
    const traverseFileTree = (entry, files) => {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file((file) => {
            files.push(file)
            resolve()
          })
        } else if (entry.isDirectory) {
          const reader = entry.createReader()
          reader.readEntries(async (entries) => {
            for (const childEntry of entries) {
              await traverseFileTree(childEntry, files)
            }
            resolve()
          })
        } else {
          resolve()
        }
      })
    }

    const handleFileSelect = (e) => {
      const files = Array.from(e.target.files)
      processFiles(files)
    }

    const handleFolderSelect = (e) => {
      const files = Array.from(e.target.files)
      processFiles(files)
    }

    const processFiles = (files) => {
      files.forEach(file => {
        const ext = file.name.split('.').pop().toLowerCase()
        const fileObj = {
          file: file,
          name: file.name,
          size: formatFileSize(file.size),
          type: ext,
          status: 'pending'
        }

        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
          musicFiles.value.push(fileObj)
        } else if (ext === 'lrc') {
          lrcFiles.value.push(fileObj)
        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          coverFiles.value.push(fileObj)
        }
      })
    }

    const formatFileSize = (bytes) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const removeMusicFile = (index) => {
      musicFiles.value.splice(index, 1)
    }

    const removeLrcFile = (index) => {
      lrcFiles.value.splice(index, 1)
    }

    const removeCoverFile = (index) => {
      coverFiles.value.splice(index, 1)
    }

    const clearAll = () => {
      musicFiles.value = []
      lrcFiles.value = []
      coverFiles.value = []
      uploadStatus.value = ''
      uploadProgress.value = 0
    }

    const uploadFiles = async () => {
      if (!hasFiles.value) return

      uploading.value = true
      uploadStatus.value = '正在上传...'
      uploadProgress.value = 0

      const allFiles = [
        ...musicFiles.value.map(f => ({ ...f, type: 'music' })),
        ...lrcFiles.value.map(f => ({ ...f, type: 'lrc' })),
        ...coverFiles.value.map(f => ({ ...f, type: 'cover' }))
      ]
      
      const totalFiles = allFiles.length
      let completedFiles = 0
      let successCount = 0
      let duplicateCount = 0
      let errorCount = 0

      try {
        // 逐个上传文件，重复文件不会中断上传
        for (const fileObj of allFiles) {
          try {
            await uploadSingleFile(fileObj, fileObj.type)
            successCount++
          } catch (error) {
            if (fileObj.status === 'duplicate') {
              duplicateCount++
            } else {
              errorCount++
              fileObj.status = 'error'
              fileObj.error = error.message
            }
          }
          completedFiles++
          uploadProgress.value = Math.round((completedFiles / totalFiles) * 100)
        }

        // 生成上传结果提示
        if (errorCount === 0) {
          if (duplicateCount > 0) {
            uploadStatus.value = `上传完成！成功 ${successCount} 个，跳过重复 ${duplicateCount} 个`
          } else {
            uploadStatus.value = '上传成功！'
          }
          
          emit('files-uploaded', {
            music: musicFiles.value.filter(f => f.status === 'uploaded').map(f => f.name),
            lrc: lrcFiles.value.filter(f => f.status === 'uploaded').map(f => f.name),
            cover: coverFiles.value.filter(f => f.status === 'uploaded').map(f => f.name)
          })

          setTimeout(() => {
            clearAll()
            emit('close')
          }, 2000)
        } else {
          uploadStatus.value = `上传完成：成功 ${successCount} 个，重复 ${duplicateCount} 个，失败 ${errorCount} 个`
        }
      } catch (error) {
        uploadStatus.value = '上传失败: ' + error.message
      } finally {
        uploading.value = false
      }
    }

    const uploadSingleFile = async (fileObj, type) => {
      const formData = new FormData()
      formData.append('file', fileObj.file)
      formData.append('type', type)

      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (!response.ok) {
        if (response.status === 409 && result.duplicate) {
          fileObj.status = 'duplicate'
          fileObj.error = '文件已存在'
          throw new Error(`"${fileObj.name}" 已存在`)
        }
        throw new Error(`上传 ${fileObj.name} 失败: ${result.error || '未知错误'}`)
      }

      fileObj.status = 'uploaded'
    }

    return {
      dragOver,
      uploading,
      uploadProgress,
      uploadStatus,
      musicFiles,
      lrcFiles,
      coverFiles,
      hasFiles,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      traverseFileTree,
      handleFileSelect,
      handleFolderSelect,
      removeMusicFile,
      removeLrcFile,
      removeCoverFile,
      clearAll,
      uploadFiles
    }
  },
  template: `
    <div class="upload-overlay" @click.self="$emit('close')">
      <div class="upload-modal">
        <div class="upload-header">
          <h2><i class="fas fa-cloud-upload-alt"></i> 上传音乐文件</h2>
          <button class="close-btn" @click="$emit('close')">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="upload-body">
          <!-- 拖拽区域 -->
          <div
            class="drop-zone"
            :class="{ 'drag-over': dragOver }"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <i class="fas fa-music"></i>
            <p>拖拽文件或文件夹到此处</p>
            <p class="sub-text">支持 MP3, WAV, FLAC, AAC, OGG, M4A 格式</p>
            <p class="sub-text">可拖拽整个文件夹，自动识别歌曲、歌词(.lrc)和封面图片</p>
            <div class="upload-buttons">
              <label class="file-input-label">
                <input
                  type="file"
                  multiple
                  accept="audio/mpeg,audio/wav,audio/flac,audio/aac,audio/ogg,audio/mp4,.lrc,image/jpeg,image/png,image/webp"
                  @change="handleFileSelect"
                  hidden
                >
                <span class="btn-select">选择文件</span>
              </label>
              <label class="file-input-label">
                <input
                  type="file"
                  webkitdirectory
                  directory
                  @change="handleFolderSelect"
                  hidden
                >
                <span class="btn-select folder">选择文件夹</span>
              </label>
            </div>
          </div>

          <!-- 文件列表 -->
          <div class="file-lists" v-if="hasFiles">
            <!-- 音乐文件列表 -->
            <div class="file-section" v-if="musicFiles.length > 0">
              <h3><i class="fas fa-music"></i> 音乐文件 ({{ musicFiles.length }})</h3>
              <div class="file-list">
                <div
                  v-for="(file, index) in musicFiles"
                  :key="index"
                  class="file-item"
                  :class="{ 
                    'uploaded': file.status === 'uploaded',
                    'duplicate': file.status === 'duplicate',
                    'error': file.status === 'error'
                  }"
                >
                  <div class="file-icon">
                    <i class="fas fa-music"></i>
                  </div>
                  <div class="file-info">
                    <span class="file-name">{{ file.name }}</span>
                    <span class="file-size">{{ file.size }}</span>
                  </div>
                  <span v-if="file.status === 'duplicate'" class="file-status">已存在</span>
                  <span v-if="file.status === 'error'" class="file-status">失败</span>
                  <button class="remove-btn" @click="removeMusicFile(index)" :disabled="uploading">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- 歌词文件列表 -->
            <div class="file-section" v-if="lrcFiles.length > 0">
              <h3><i class="fas fa-file-alt"></i> 歌词文件 ({{ lrcFiles.length }})</h3>
              <div class="file-list">
                <div
                  v-for="(file, index) in lrcFiles"
                  :key="index"
                  class="file-item"
                  :class="{ 
                    'uploaded': file.status === 'uploaded',
                    'duplicate': file.status === 'duplicate',
                    'error': file.status === 'error'
                  }"
                >
                  <div class="file-icon lrc">
                    <i class="fas fa-file-alt"></i>
                  </div>
                  <div class="file-info">
                    <span class="file-name">{{ file.name }}</span>
                    <span class="file-size">{{ file.size }}</span>
                  </div>
                  <span v-if="file.status === 'duplicate'" class="file-status">已存在</span>
                  <span v-if="file.status === 'error'" class="file-status">失败</span>
                  <button class="remove-btn" @click="removeLrcFile(index)" :disabled="uploading">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- 封面文件列表 -->
            <div class="file-section" v-if="coverFiles.length > 0">
              <h3><i class="fas fa-image"></i> 封面图片 ({{ coverFiles.length }})</h3>
              <div class="file-list">
                <div
                  v-for="(file, index) in coverFiles"
                  :key="index"
                  class="file-item"
                  :class="{ 
                    'uploaded': file.status === 'uploaded',
                    'duplicate': file.status === 'duplicate',
                    'error': file.status === 'error'
                  }"
                >
                  <div class="file-icon cover">
                    <i class="fas fa-image"></i>
                  </div>
                  <div class="file-info">
                    <span class="file-name">{{ file.name }}</span>
                    <span class="file-size">{{ file.size }}</span>
                  </div>
                  <span v-if="file.status === 'duplicate'" class="file-status">已存在</span>
                  <span v-if="file.status === 'error'" class="file-status">失败</span>
                  <button class="remove-btn" @click="removeCoverFile(index)" :disabled="uploading">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 上传进度 -->
          <div class="upload-progress" v-if="uploading || uploadStatus">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
            </div>
            <span class="progress-text">{{ uploadStatus }} {{ uploadProgress }}%</span>
          </div>
        </div>

        <!-- 底部按钮 -->
        <div class="upload-footer">
          <button class="btn-secondary" @click="clearAll" :disabled="uploading || !hasFiles">
            <i class="fas fa-trash-alt"></i> 清空
          </button>
          <button class="btn-primary" @click="uploadFiles" :disabled="uploading || !hasFiles">
            <i class="fas fa-upload"></i> 
            {{ uploading ? '上传中...' : '开始上传' }}
          </button>
        </div>
      </div>
    </div>
  `
}
