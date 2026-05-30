/**
 * ImageLoader - 图片懒加载和缓存服务
 * 优化大量图片并发加载问题
 */

class ImageLoader {
  constructor() {
    // 图片缓存
    this.cache = new Map()
    // 正在加载的图片
    this.loading = new Map()
    // 懒加载观察器
    this.observer = null
    // 默认封面
    this.defaultCover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23e0e0e0"/%3E%3C/svg%3E'
    
    this.initObserver()
  }

  /**
   * 初始化 Intersection Observer
   */
  initObserver() {
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target
            this.loadImage(img)
            this.observer.unobserve(img)
          }
        })
      }, {
        rootMargin: '50px 0px', // 提前 50px 开始加载
        threshold: 0.01
      })
    }
  }

  /**
   * 懒加载图片
   * @param {HTMLImageElement} img - 图片元素
   * @param {string} src - 真实图片地址
   */
  lazyLoad(img, src) {
    // 如果已经在缓存中，直接显示
    if (this.cache.has(src)) {
      img.src = this.cache.get(src)
      return
    }

    // 保存真实地址
    img.dataset.src = src
    // 显示占位图
    img.src = this.defaultCover
    
    // 使用观察器懒加载
    if (this.observer) {
      this.observer.observe(img)
    } else {
      // 不支持观察器的浏览器直接加载
      this.loadImage(img)
    }
  }

  /**
   * 加载图片
   * @param {HTMLImageElement} img - 图片元素
   */
  async loadImage(img) {
    const src = img.dataset.src
    if (!src || src === this.defaultCover) return

    // 如果已经在加载中，等待加载完成
    if (this.loading.has(src)) {
      try {
        const cachedSrc = await this.loading.get(src)
        img.src = cachedSrc
      } catch (e) {
        img.src = this.defaultCover
      }
      return
    }

    // 开始加载
    const loadPromise = this.fetchImage(src)
    this.loading.set(src, loadPromise)

    try {
      const cachedSrc = await loadPromise
      img.src = cachedSrc
    } catch (e) {
      img.src = this.defaultCover
    } finally {
      this.loading.delete(src)
    }
  }

  /**
   * 获取图片
   * @param {string} src - 图片地址
   * @returns {Promise<string>} 图片 data URL 或原始地址
   */
  fetchImage(src) {
    return new Promise((resolve, reject) => {
      // 检查缓存
      if (this.cache.has(src)) {
        resolve(this.cache.get(src))
        return
      }

      // 如果是 data URL，直接缓存
      if (src.startsWith('data:')) {
        this.cache.set(src, src)
        resolve(src)
        return
      }

      // 加载图片
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      img.onload = () => {
        // 可选：转换为 data URL 缓存（会占用更多内存，但更快）
        // 这里直接缓存原地址
        this.cache.set(src, src)
        resolve(src)
      }
      
      img.onerror = () => {
        reject(new Error(`Failed to load image: ${src}`))
      }
      
      img.src = src
    })
  }

  /**
   * 预加载图片
   * @param {string[]} srcs - 图片地址数组
   */
  preload(srcs) {
    // 使用 requestIdleCallback 在空闲时预加载
    const preloadBatch = () => {
      const batch = srcs.splice(0, 3) // 每次加载 3 张
      batch.forEach(src => {
        if (!this.cache.has(src) && !this.loading.has(src)) {
          this.fetchImage(src).catch(() => {})
        }
      })
      
      if (srcs.length > 0) {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(preloadBatch, { timeout: 1000 })
        } else {
          setTimeout(preloadBatch, 100)
        }
      }
    }
    
    preloadBatch()
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear()
    this.loading.clear()
  }

  /**
   * 获取默认封面
   */
  getDefaultCover() {
    return this.defaultCover
  }
}

// 单例模式
let imageLoaderInstance = null

function getImageLoader() {
  if (!imageLoaderInstance) {
    imageLoaderInstance = new ImageLoader()
  }
  return imageLoaderInstance
}

export { ImageLoader, getImageLoader }
export default ImageLoader
