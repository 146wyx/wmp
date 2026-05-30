/**
 * LazyImage - 懒加载图片组件
 * 优化大量图片并发加载
 */

import { getImageLoader } from '../utils/ImageLoader.js'

export default {
  name: 'LazyImage',
  
  props: {
    src: {
      type: String,
      default: ''
    },
    alt: {
      type: String,
      default: ''
    },
    className: {
      type: String,
      default: ''
    }
  },
  
  setup(props) {
    const imageLoader = getImageLoader()
    const imgRef = Vue.ref(null)
    
    Vue.onMounted(() => {
      if (imgRef.value && props.src) {
        imageLoader.lazyLoad(imgRef.value, props.src)
      }
    })
    
    Vue.watch(() => props.src, (newSrc) => {
      if (imgRef.value && newSrc) {
        imageLoader.lazyLoad(imgRef.value, newSrc)
      }
    })
    
    return {
      imgRef,
      defaultCover: imageLoader.getDefaultCover()
    }
  },
  
  template: `
    <img
      ref="imgRef"
      :src="defaultCover"
      :alt="alt"
      :class="className"
      loading="lazy"
    />
  `
}
