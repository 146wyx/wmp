/**
 * Services Index - 服务模块入口
 * 统一导出所有服务模块
 */

// 工具模块
export * from '../utils/StorageUtils.js'
export * from '../utils/AudioUtils.js'
export * from '../utils/LyricsParser.js'

// 状态存储
export * from '../stores/PlayerStore.js'

// 服务模块
export * from './PlayerService.js'
export * from './PlaylistService.js'
export * from './HistoryService.js'

// 初始化所有服务
import { getPlayerStore } from '../stores/PlayerStore.js'
import { getPlayerService } from './PlayerService.js'
import { getPlaylistService } from './PlaylistService.js'
import { getHistoryService } from './HistoryService.js'

/**
 * 初始化所有播放器服务
 * @returns {Promise<Object>} 所有服务的引用
 */
async function initPlayerServices() {
  console.log('[PlayerServices] Initializing all services...')
  
  // 初始化状态存储
  const store = getPlayerStore()
  await store.actions.init()
  
  // 初始化播放服务
  const playerService = getPlayerService()
  await playerService.init()
  
  // 初始化播放列表服务
  const playlistService = getPlaylistService()
  await playlistService.init()
  
  // 初始化历史服务
  const historyService = getHistoryService()
  await historyService.init()
  
  console.log('[PlayerServices] All services initialized')
  
  return {
    store,
    playerService,
    playlistService,
    historyService
  }
}

// 将服务挂载到全局，方便在模板中使用
window.PlayerServices = {
  init: initPlayerServices,
  getPlayerStore,
  getPlayerService,
  getPlaylistService,
  getHistoryService
}

export { initPlayerServices }
