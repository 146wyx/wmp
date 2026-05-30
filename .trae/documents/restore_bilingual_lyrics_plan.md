# 恢复双语歌词显示功能计划

## [ ] Task 1: 修复LyricsParser，恢复双语歌词解析
- **Priority**: P0
- **Depends On**: None
- **Description**: 
  - 恢复LyricsParser类结构
  - 重新实现双语歌词检测和合并逻辑
  - 确保parse方法正常工作
- **Success Criteria**: 
  - LyricsParser能正确解析LRC文件
  - 支持双语歌词（同一时间戳有不同语言）
  - parse方法返回包含primary和secondary字段的歌词对象
- **Test Requirements**: 
  - `programmatic` TR-1.1: 解析3.6.5-EXO.lrc文件，返回正确的双语歌词结构
  - `programmatic` TR-1.2: parse方法不抛出错误
- **Notes**: 参考之前的实现，确保支持韩文+中文、英文+中文等双语组合

## [ ] Task 2: 修复PlayerService中LyricsParser的使用
- **Priority**: P0
- **Depends On**: Task 1
- **Description**: 
  - 确保正确导入LyricsParser
  - 修复new LyricsParser()调用
  - 确保loadLyrics方法正常工作
- **Success Criteria**: 
  - PlayerService初始化不报错
  - loadLyrics方法能正确解析歌词
- **Test Requirements**: 
  - `programmatic` TR-2.1: PlayerService初始化成功
  - `programmatic` TR-2.2: 加载歌曲时能正确解析歌词
- **Notes**: 检查import语句和构造函数调用

## [ ] Task 3: 恢复模板中的双语歌词显示
- **Priority**: P1
- **Depends On**: Task 2
- **Description**: 
  - 修改MusicPlayer.js模板，恢复双语歌词显示
  - 支持primary（原文）和secondary（译文）显示
- **Success Criteria**: 
  - 模板能正确显示双语歌词
  - 原文和译文格式正确
- **Test Requirements**: 
  - `human-judgement` TR-3.1: 双语歌词显示正确，原文在上，译文在下
  - `human-judgement` TR-3.2: 单语歌词显示正常
- **Notes**: 使用之前的模板结构，确保条件判断正确

## [ ] Task 4: 恢复双语歌词CSS样式
- **Priority**: P1
- **Depends On**: Task 3
- **Description**: 
  - 恢复.lyric-line.bilingual相关样式
  - 确保原文和译文的字体大小、颜色等样式正确
- **Success Criteria**: 
  - 双语歌词样式美观
  - 原文醒目，译文清晰
- **Test Requirements**: 
  - `human-judgement` TR-4.1: 双语歌词样式与之前一致
  - `human-judgement` TR-4.2: 高亮效果正常
- **Notes**: 参考之前的CSS样式，确保响应式设计

## [ ] Task 5: 测试验证
- **Priority**: P2
- **Depends On**: Task 4
- **Description**: 
  - 测试3.6.5-EXO.lrc双语歌词
  - 测试Would U Be Mine-张艺兴.lrc单语歌词
  - 确保所有功能正常
- **Success Criteria**: 
  - 双语歌词正确显示
  - 单语歌词正确显示
  - 无错误发生
- **Test Requirements**: 
  - `programmatic` TR-5.1: 无控制台错误
  - `human-judgement` TR-5.2: 歌词显示美观，符合预期
- **Notes**: 测试不同类型的歌词文件
