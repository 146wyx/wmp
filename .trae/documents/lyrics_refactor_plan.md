# 歌词重构实现计划

## 项目背景
当前歌词实现存在以下问题：
- 歌词渲染逻辑与主播放器组件耦合
- 缺少平滑的滚动动画效果
- 歌词高亮逻辑不够灵活
- 双语歌词处理复杂但缺少更多样式选项
- 缺少歌词同步的视觉反馈

## 重构目标
1. 创建独立的歌词组件，实现关注点分离
2. 优化歌词渲染和滚动逻辑
3. 添加流畅的动画效果
4. 增强双语歌词的显示能力
5. 提高歌词同步的准确性

## 详细任务计划

### [x] 任务 1: 创建独立的歌词组件
- **Priority**: P0
- **Depends On**: None
- **Description**: 
  - 创建 `LyricsComponent.vue` 组件
  - 迁移歌词渲染逻辑到新组件
  - 定义清晰的 props 接口
- **Success Criteria**:
  - 歌词组件能够独立渲染
  - 与主播放器组件通过 props 正确通信
  - 保持现有功能完整性
- **Test Requirements**:
  - `programmatic` TR-1.1: 组件能够正确接收和渲染歌词数组
  - `programmatic` TR-1.2: 组件能够响应 currentLyricIndex 变化
  - `human-judgement` TR-1.3: 代码结构清晰，符合组件化设计原则
- **Notes**: 确保组件接口设计合理，便于未来扩展

### [x] 任务 2: 优化歌词滚动和高亮逻辑
- **Priority**: P0
- **Depends On**: 任务 1
- **Description**:
  - 实现基于 CSS transform 的平滑滚动
  - 优化歌词高亮的计算逻辑
  - 添加滚动动画效果
- **Success Criteria**:
  - 歌词滚动平滑，无卡顿
  - 高亮歌词始终保持在视野中央
  - 滚动动画自然流畅
- **Test Requirements**:
  - `programmatic` TR-2.1: 滚动位置计算准确
  - `programmatic` TR-2.2: 动画性能良好（60fps）
  - `human-judgement` TR-2.3: 滚动效果流畅自然
- **Notes**: 使用 requestAnimationFrame 优化动画性能

### [x] 任务 3: 增强双语歌词支持
- **Priority**: P1
- **Depends On**: 任务 1
- **Description**:
  - 优化双语歌词的布局结构
  - 添加更多双语显示模式选项
  - 增强双语歌词的样式控制
- **Success Criteria**:
  - 双语歌词显示更加美观
  - 支持多种双语排版模式
  - 样式可通过配置调整
- **Test Requirements**:
  - `programmatic` TR-3.1: 双语歌词正确解析和渲染
  - `human-judgement` TR-3.2: 双语显示效果美观易读
  - `human-judgement` TR-3.3: 排版布局合理
- **Notes**: 考虑不同屏幕尺寸的适配

### [x] 任务 4: 实现歌词同步增强功能
- **Priority**: P1
- **Depends On**: 任务 2
- **Description**:
  - 添加歌词进度条显示
  - 实现歌词点击跳转功能
  - 增强歌词同步的视觉反馈
- **Success Criteria**:
  - 歌词进度条准确反映当前播放位置
  - 点击歌词能够跳转到对应时间
  - 同步过程有清晰的视觉反馈
- **Test Requirements**:
  - `programmatic` TR-4.1: 歌词进度条位置准确
  - `programmatic` TR-4.2: 点击歌词跳转功能正常
  - `human-judgement` TR-4.3: 视觉反馈清晰直观
- **Notes**: 确保点击跳转与现有 seek 功能协调

### [x] 任务 5: 集成到主播放器组件
- **Priority**: P0
- **Depends On**: 任务 1, 任务 2
- **Description**:
  - 在 MusicPlayer.js 中集成新歌词组件
  - 更新相关状态管理逻辑
  - 确保与现有功能的兼容性
- **Success Criteria**:
  - 新组件与主播放器无缝集成
  - 所有现有功能正常工作
  - 代码结构更加清晰
- **Test Requirements**:
  - `programmatic` TR-5.1: 播放器所有功能正常
  - `programmatic` TR-5.2: 歌词与播放进度同步正确
  - `human-judgement` TR-5.3: 用户体验流畅一致
- **Notes**: 保持向后兼容性，避免破坏现有功能

### [x] 任务 6: 优化样式和响应式设计
- **Priority**: P2
- **Depends On**: 任务 3, 任务 5
- **Description**:
  - 优化歌词相关的 CSS 样式
  - 增强响应式布局支持
  - 添加主题适配能力
- **Success Criteria**:
  - 歌词显示在不同设备上都美观
  - 支持不同屏幕尺寸的适配
  - 能够与播放器主题协调一致
- **Test Requirements**:
  - `programmatic` TR-6.1: 在不同屏幕尺寸下显示正常
  - `human-judgement` TR-6.2: 样式美观，符合设计规范
  - `human-judgement` TR-6.3: 响应式效果良好
- **Notes**: 考虑移动设备和桌面设备的不同体验

### [x] 任务 7: 测试和性能优化
- **Priority**: P1
- **Depends On**: 所有任务
- **Description**:
  - 全面测试歌词功能
  - 优化性能和内存使用
  - 修复发现的问题
- **Success Criteria**:
  - 所有功能测试通过
  - 性能达到预期标准
  - 无明显的内存泄漏
- **Test Requirements**:
  - `programmatic` TR-7.1: 所有功能测试通过
  - `programmatic` TR-7.2: 性能测试达标
  - `human-judgement` TR-7.3: 整体体验流畅
- **Notes**: 使用浏览器开发者工具进行性能分析

## 技术栈和实现方式
- **前端框架**: Vue 3 (Composition API)
- **样式方案**: CSS3 + CSS Variables
- **动画技术**: CSS Transitions + requestAnimationFrame
- **代码组织**: 组件化 + 模块化

## 预期效果
- 歌词显示更加美观流畅
- 滚动动画自然平滑
- 双语歌词支持更加完善
- 代码结构更加清晰可维护
- 用户体验显著提升

## 风险评估
- **风险 1**: 组件化可能引入额外的复杂性
  - **缓解措施**: 设计简洁的组件接口，保持逻辑清晰
- **风险 2**: 动画效果可能影响性能
  - **缓解措施**: 使用硬件加速，优化动画逻辑
- **风险 3**: 向后兼容性问题
  - **缓解措施**: 保持现有 API 不变，渐进式改进

## 时间估计
- 任务 1-2: 2 小时
- 任务 3-4: 1.5 小时
- 任务 5-6: 1 小时
- 任务 7: 0.5 小时
- **总估计时间**: 5 小时