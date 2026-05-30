import { createApp, ref, reactive, readonly, computed, onMounted, onUnmounted, watch, nextTick } from './js/vue.esm-browser.js'
import App from './App.js'

// 将 Vue API 暴露到全局，供组件使用
window.Vue = { ref, reactive, readonly, computed, onMounted, onUnmounted, watch, nextTick }

createApp(App).mount('#app')
