import MusicPlayer from './components/MusicPlayer.js'
import Upload from './components/Upload.js'

// API 基础 URL 配置
// 指向后端服务器的地址
// 如果前端和后端在同一域名下，使用空字符串
// 如果后端在不同地址，需要指定完整 URL
const API_BASE_URL = ''

export default {
  name: 'App',
  components: {
    MusicPlayer,
    Upload
  },
  setup() {
    const { ref, reactive, onMounted, watch } = window.Vue
    const showUpload = ref(false)
    const musicPlayerRef = ref(null)
    const isLoggedIn = ref(false)
    const showLoginModal = ref(false)
    const isRegisterMode = ref(false)
    const currentUser = ref(null)
    const authError = ref('')
    const isLoading = ref(false)
    const rememberMe = ref(false)
    const showUserMenu = ref(false)
    const showChangePasswordModal = ref(false)

    // 表单数据
    const authForm = reactive({
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    })

    // 修改密码表单
    const passwordForm = reactive({
      oldPassword: '',
      newPassword: '',
      confirmNewPassword: ''
    })

    // 密码强度
    const passwordStrength = ref(0)
    const passwordStrengthText = ref('')

    // 登录历史
    const loginHistory = ref([])

    // 收藏列表
    const favorites = ref([])
    const showFavoritesModal = ref(false)

    // 检查密码强度
    const checkPasswordStrength = (password) => {
      let strength = 0
      if (password.length >= 6) strength++
      if (password.length >= 10) strength++
      if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++
      if (/\d/.test(password)) strength++
      if (/[^a-zA-Z0-9]/.test(password)) strength++

      passwordStrength.value = strength
      const texts = ['极弱', '弱', '一般', '中等', '强', '极强']
      passwordStrengthText.value = texts[strength] || '极弱'
      return strength
    }

    // 验证邮箱格式
    const validateEmail = (email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email)
    }

    // 从 localStorage 加载登录状态
    const loadAuthState = () => {
      const savedAuth = localStorage.getItem('musicPlayerAuth')
      if (savedAuth) {
        try {
          const authData = JSON.parse(savedAuth)
          if (authData.isLoggedIn && authData.user) {
            isLoggedIn.value = true
            currentUser.value = authData.user
            rememberMe.value = authData.rememberMe || false
          }
        } catch (e) {
          console.error('加载登录状态失败:', e)
        }
      }
    }

    // 保存登录状态到 localStorage
    const saveAuthState = () => {
      if (rememberMe.value && isLoggedIn.value) {
        localStorage.setItem('musicPlayerAuth', JSON.stringify({
          isLoggedIn: isLoggedIn.value,
          user: currentUser.value,
          rememberMe: rememberMe.value,
          loginTime: new Date().toISOString()
        }))
      } else {
        localStorage.removeItem('musicPlayerAuth')
      }
    }

    // 添加登录历史记录
    const addLoginHistory = (email, success, errorMsg = '') => {
      const history = JSON.parse(localStorage.getItem('loginHistory') || '[]')
      history.unshift({
        email,
        time: new Date().toISOString(),
        success,
        error: errorMsg,
        ip: 'local'
      })
      // 只保留最近 20 条记录
      if (history.length > 20) history.pop()
      localStorage.setItem('loginHistory', JSON.stringify(history))
      loginHistory.value = history
    }

    const openUpload = () => {
      showUpload.value = true
    }

    const closeUpload = () => {
      showUpload.value = false
    }

    const handleFilesUploaded = () => {
      if (musicPlayerRef.value && musicPlayerRef.value.loadMusicList) {
        musicPlayerRef.value.loadMusicList()
      }
    }

    const openLogin = () => {
      showLoginModal.value = true
      authError.value = ''
    }

    const closeLogin = () => {
      showLoginModal.value = false
      authError.value = ''
      authForm.username = ''
      authForm.email = ''
      authForm.password = ''
      authForm.confirmPassword = ''
      passwordStrength.value = 0
    }

    const handleLogin = async () => {
      if (!authForm.email || !authForm.password) {
        authError.value = '请填写邮箱和密码'
        return
      }

      if (!validateEmail(authForm.email)) {
        authError.value = '请输入有效的邮箱地址'
        return
      }

      isLoading.value = true
      authError.value = ''

      try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password
          })
        })

        const result = await response.json()

        if (result.success) {
          isLoggedIn.value = true
          currentUser.value = result.user
          showLoginModal.value = false
          addLoginHistory(authForm.email, true)
          saveAuthState()
          authForm.email = ''
          authForm.password = ''
        } else {
          authError.value = result.error || '登录失败'
          addLoginHistory(authForm.email, false, result.error)
        }
      } catch (error) {
        console.error('登录失败:', error)
        authError.value = '网络错误，请重试'
        addLoginHistory(authForm.email, false, '网络错误')
      } finally {
        isLoading.value = false
      }
    }

    const handleRegister = async () => {
      if (!authForm.username || !authForm.email || !authForm.password) {
        authError.value = '请填写所有必填项'
        return
      }

      if (!validateEmail(authForm.email)) {
        authError.value = '请输入有效的邮箱地址'
        return
      }

      if (authForm.password.length < 6) {
        authError.value = '密码长度至少为6位'
        return
      }

      if (authForm.password !== authForm.confirmPassword) {
        authError.value = '两次输入的密码不一致'
        return
      }

      isLoading.value = true
      authError.value = ''

      try {
        const response = await fetch(`${API_BASE_URL}/api/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: authForm.username,
            email: authForm.email,
            password: authForm.password
          })
        })

        const result = await response.json()

        if (result.success) {
          isLoggedIn.value = true
          currentUser.value = result.user
          showLoginModal.value = false
          addLoginHistory(authForm.email, true)
          saveAuthState()
          authForm.username = ''
          authForm.email = ''
          authForm.password = ''
          authForm.confirmPassword = ''
          passwordStrength.value = 0
        } else {
          authError.value = result.error || '注册失败'
        }
      } catch (error) {
        console.error('注册失败:', error)
        authError.value = '网络错误，请重试'
      } finally {
        isLoading.value = false
      }
    }

    const handleLogout = () => {
      isLoggedIn.value = false
      currentUser.value = null
      showUserMenu.value = false
      localStorage.removeItem('musicPlayerAuth')
    }

    const toggleAuthMode = () => {
      isRegisterMode.value = !isRegisterMode.value
      authError.value = ''
      passwordStrength.value = 0
    }

    // 修改密码
    const handleChangePassword = async () => {
      if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmNewPassword) {
        authError.value = '请填写所有密码字段'
        return
      }

      if (passwordForm.newPassword.length < 6) {
        authError.value = '新密码长度至少为6位'
        return
      }

      if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
        authError.value = '两次输入的新密码不一致'
        return
      }

      isLoading.value = true
      authError.value = ''

      try {
        const response = await fetch(`${API_BASE_URL}/api/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: currentUser.value.email,
            oldPassword: passwordForm.oldPassword,
            newPassword: passwordForm.newPassword
          })
        })

        const result = await response.json()

        if (result.success) {
          showChangePasswordModal.value = false
          passwordForm.oldPassword = ''
          passwordForm.newPassword = ''
          passwordForm.confirmNewPassword = ''
          alert('密码修改成功！')
        } else {
          authError.value = result.error || '修改密码失败'
        }
      } catch (error) {
        console.error('修改密码失败:', error)
        authError.value = '网络错误，请重试'
      } finally {
        isLoading.value = false
      }
    }

    // 点击外部关闭用户菜单
    const handleClickOutside = (e) => {
      if (showUserMenu.value && !e.target.closest('.user-menu-container')) {
        showUserMenu.value = false
      }
    }

    // 加载用户收藏列表
    const loadFavorites = async () => {
      if (!isLoggedIn.value || !currentUser.value) {
        favorites.value = []
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/favorites?username=${encodeURIComponent(currentUser.value.username)}`)
        const result = await response.json()

        if (result.success) {
          favorites.value = result.data || []
        }
      } catch (error) {
        console.error('加载收藏列表失败:', error)
      }
    }

    // 添加收藏
    const addToFavorites = async (song) => {
      console.log('添加收藏:', song)
      if (!isLoggedIn.value || !currentUser.value) {
        alert('请先登录后再收藏歌曲')
        return false
      }

      if (!song || !song.filename) {
        console.error('歌曲数据不完整:', song)
        alert('歌曲数据不完整，无法收藏')
        return false
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/favorites/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser.value.username,
            song: song
          })
        })

        const result = await response.json()
        console.log('收藏结果:', result)

        if (result.success) {
          favorites.value = result.data
          return true
        } else {
          console.error('添加收藏失败:', result.error)
          alert(result.error || '添加收藏失败')
          return false
        }
      } catch (error) {
        console.error('添加收藏失败:', error)
        alert('网络错误，请重试')
        return false
      }
    }

    // 从收藏中移除
    const removeFromFavorites = async (filename) => {
      if (!isLoggedIn.value || !currentUser.value) return false

      try {
        const response = await fetch(`${API_BASE_URL}/api/favorites/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser.value.username,
            filename: filename
          })
        })

        const result = await response.json()

        if (result.success) {
          favorites.value = result.data
          return true
        }
        return false
      } catch (error) {
        console.error('移除收藏失败:', error)
        return false
      }
    }

    // 检查歌曲是否已收藏
    const isFavorite = (filename) => {
      return favorites.value.some(f => f.filename === filename)
    }

    onMounted(() => {
      loadAuthState()
      loginHistory.value = JSON.parse(localStorage.getItem('loginHistory') || '[]')
      document.addEventListener('click', handleClickOutside)
      loadFavorites()
    })

    // 监听登录状态变化，加载收藏
    watch(isLoggedIn, (newVal) => {
      if (newVal) {
        loadFavorites()
      } else {
        favorites.value = []
      }
    })

    watch(rememberMe, saveAuthState)

    return {
      showUpload,
      musicPlayerRef,
      isLoggedIn,
      showLoginModal,
      isRegisterMode,
      currentUser,
      authError,
      isLoading,
      authForm,
      rememberMe,
      showUserMenu,
      showChangePasswordModal,
      passwordForm,
      passwordStrength,
      passwordStrengthText,
      loginHistory,
      favorites,
      showFavoritesModal,
      openUpload,
      closeUpload,
      handleFilesUploaded,
      openLogin,
      closeLogin,
      handleLogin,
      handleRegister,
      handleLogout,
      toggleAuthMode,
      checkPasswordStrength,
      handleChangePassword,
      addToFavorites,
      removeFromFavorites,
      isFavorite
    }
  },
  template: `
    <div class="app">
      <MusicPlayer
        ref="musicPlayerRef"
        @open-upload="openUpload"
        :is-logged-in="isLoggedIn"
        :current-user="currentUser"
        :favorites="favorites"
        @open-login="openLogin"
        @logout="handleLogout"
        @add-favorite="addToFavorites"
        @remove-favorite="removeFromFavorites"
        @show-favorites="showFavoritesModal = true"
      />
      <Upload
        v-if="showUpload"
        @close="closeUpload"
        @files-uploaded="handleFilesUploaded"
      />

      <!-- 登录/注册弹窗 -->
      <div v-if="showLoginModal" class="login-overlay" @click="closeLogin">
        <div class="login-modal" @click.stop>
          <div class="login-header">
            <h2>
              <i :class="['fas', isRegisterMode ? 'fa-user-plus' : 'fa-user-circle']"></i>
              {{ isRegisterMode ? '用户注册' : '用户登录' }}
            </h2>
            <button class="close-btn" @click="closeLogin">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="login-body">
            <div class="login-form">
              <!-- 错误提示 -->
              <div v-if="authError" class="auth-error">
                <i class="fas fa-exclamation-circle"></i>
                {{ authError }}
              </div>

              <!-- 注册时显示用户名 -->
              <div v-if="isRegisterMode" class="form-group">
                <label><i class="fas fa-user"></i> 用户名</label>
                <input
                  type="text"
                  v-model="authForm.username"
                  placeholder="请输入用户名"
                  :disabled="isLoading"
                  maxlength="20"
                >
              </div>
              <div class="form-group">
                <label><i class="fas fa-envelope"></i> 邮箱</label>
                <input
                  type="email"
                  v-model="authForm.email"
                  placeholder="请输入邮箱"
                  :disabled="isLoading"
                >
              </div>
              <div class="form-group">
                <label><i class="fas fa-lock"></i> 密码</label>
                <input
                  type="password"
                  v-model="authForm.password"
                  placeholder="请输入密码"
                  :disabled="isLoading"
                  @input="isRegisterMode && checkPasswordStrength(authForm.password)"
                >
                <!-- 密码强度指示器 -->
                <div v-if="isRegisterMode && authForm.password" class="password-strength">
                  <div class="strength-bar">
                    <div
                      class="strength-fill"
                      :style="{ width: (passwordStrength / 5 * 100) + '%' }"
                      :class="'strength-' + passwordStrength"
                    ></div>
                  </div>
                  <span class="strength-text" :class="'strength-text-' + passwordStrength">
                    密码强度: {{ passwordStrengthText }}
                  </span>
                </div>
              </div>
              <!-- 注册时显示确认密码 -->
              <div v-if="isRegisterMode" class="form-group">
                <label><i class="fas fa-lock"></i> 确认密码</label>
                <input
                  type="password"
                  v-model="authForm.confirmPassword"
                  placeholder="请再次输入密码"
                  :disabled="isLoading"
                >
              </div>

              <!-- 记住我选项 -->
              <div v-if="!isRegisterMode" class="form-group remember-me">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="rememberMe">
                  <span class="checkmark"></span>
                  <span class="label-text">记住登录状态</span>
                </label>
              </div>

              <button
                class="btn-login-submit"
                :class="{ 'loading': isLoading }"
                :disabled="isLoading"
                @click="isRegisterMode ? handleRegister() : handleLogin()"
              >
                <i v-if="!isLoading" :class="['fas', isRegisterMode ? 'fa-user-plus' : 'fa-sign-in-alt']"></i>
                <i v-else class="fas fa-spinner fa-spin"></i>
                {{ isLoading ? '处理中...' : (isRegisterMode ? '注册' : '登录') }}
              </button>

              <!-- 切换登录/注册 -->
              <div class="auth-switch">
                <span>{{ isRegisterMode ? '已有账号？' : '还没有账号？' }}</span>
                <button class="switch-btn" @click="toggleAuthMode" :disabled="isLoading">
                  {{ isRegisterMode ? '立即登录' : '立即注册' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 修改密码弹窗 -->
      <div v-if="showChangePasswordModal" class="login-overlay" @click="showChangePasswordModal = false">
        <div class="login-modal" @click.stop>
          <div class="login-header">
            <h2><i class="fas fa-key"></i> 修改密码</h2>
            <button class="close-btn" @click="showChangePasswordModal = false">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="login-body">
            <div class="login-form">
              <div v-if="authError" class="auth-error">
                <i class="fas fa-exclamation-circle"></i>
                {{ authError }}
              </div>
              <div class="form-group">
                <label><i class="fas fa-lock"></i> 当前密码</label>
                <input
                  type="password"
                  v-model="passwordForm.oldPassword"
                  placeholder="请输入当前密码"
                  :disabled="isLoading"
                >
              </div>
              <div class="form-group">
                <label><i class="fas fa-lock"></i> 新密码</label>
                <input
                  type="password"
                  v-model="passwordForm.newPassword"
                  placeholder="请输入新密码"
                  :disabled="isLoading"
                  @input="checkPasswordStrength(passwordForm.newPassword)"
                >
                <div v-if="passwordForm.newPassword" class="password-strength">
                  <div class="strength-bar">
                    <div
                      class="strength-fill"
                      :style="{ width: (passwordStrength / 5 * 100) + '%' }"
                      :class="'strength-' + passwordStrength"
                    ></div>
                  </div>
                  <span class="strength-text" :class="'strength-text-' + passwordStrength">
                    密码强度: {{ passwordStrengthText }}
                  </span>
                </div>
              </div>
              <div class="form-group">
                <label><i class="fas fa-lock"></i> 确认新密码</label>
                <input
                  type="password"
                  v-model="passwordForm.confirmNewPassword"
                  placeholder="请再次输入新密码"
                  :disabled="isLoading"
                >
              </div>
              <button
                class="btn-login-submit"
                :class="{ 'loading': isLoading }"
                :disabled="isLoading"
                @click="handleChangePassword"
              >
                <i v-if="!isLoading" class="fas fa-save"></i>
                <i v-else class="fas fa-spinner fa-spin"></i>
                {{ isLoading ? '保存中...' : '保存修改' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 收藏列表弹窗 -->
      <div v-if="showFavoritesModal" class="login-overlay favorites-overlay" @click="showFavoritesModal = false">
        <div class="login-modal favorites-modal" @click.stop>
          <div class="login-header">
            <h2><i class="fas fa-heart" style="color: var(--accent-color);"></i> 我的收藏</h2>
            <button class="close-btn" @click="showFavoritesModal = false">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="login-body">
            <div v-if="favorites.length === 0" class="empty-favorites">
              <i class="far fa-heart"></i>
              <p>还没有收藏任何歌曲</p>
              <span>点击歌曲列表中的 <i class="far fa-heart"></i> 按钮添加收藏</span>
            </div>
            <div v-else class="favorites-list">
              <div
                v-for="song in favorites"
                :key="song.filename"
                class="favorite-item"
              >
                <img :src="song.coverUrl || song.cover || '/data/Segment/default.jpg'" :alt="song.title" class="favorite-cover">
                <div class="favorite-info">
                  <div class="favorite-title">{{ song.title }}</div>
                  <div class="favorite-artist">{{ song.artist }}</div>
                </div>
                <button
                  class="remove-favorite-btn"
                  @click="removeFromFavorites(song.filename)"
                  title="取消收藏"
                >
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}
