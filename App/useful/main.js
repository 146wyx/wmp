import { createApp, ref, reactive, computed, onMounted, onUnmounted, watch } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import App from './App.js'

// 将 Vue API 暴露到全局，供组件使用
window.Vue = { ref, reactive, computed, onMounted, onUnmounted, watch }

createApp(App).mount('#app')
