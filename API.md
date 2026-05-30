# 音乐播放器 API 文档

## 基础信息

- **基础 URL**: `https://music.mtim.top/`
- **数据格式**: JSON
- **字符编码**: UTF-8

## 响应格式

所有 API 响应都遵循以下格式：

```json
{
  "success": true,
  "data": {},
  "error": "错误信息"
}
```

## API 列表

### 1. 音乐列表

#### 获取音乐列表

```http
GET /api/music-list
```

**响应示例**:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "filename": "song.mp3",
      "title": "歌曲名",
      "artist": "艺术家",
      "album": "专辑名",
      "duration": 180,
      "size": 5242880,
      "mime_type": "audio/mpeg",
      "url": "/music/song.mp3",
      "coverUrl": "/covers/song.jpg",
      "hasLyrics": true,
      "lrcUrl": "/lyrics/song.lrc",
      "hasCover": true
    }
  ]
}
```

---

### 2. 文件上传

#### 上传音乐文件

```http
POST /api/upload
Content-Type: multipart/form-data
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 音频文件 |
| type | string | 是 | 文件类型: `music`, `lrc`, `cover` |

**支持的音频格式**: MP3, WAV, FLAC, AAC, OGG, M4A

**响应示例**:

```json
{
  "success": true,
  "data": {
    "filename": "song.mp3",
    "url": "/music/song.mp3",
    "title": "歌曲名",
    "artist": "艺术家"
  }
}
```

---

### 3. 歌词获取

#### 获取歌词内容

```http
GET /api/lyrics?filename={filename}
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filename | string | 是 | 歌曲文件名 |

**响应示例**:

```json
{
  "success": true,
  "data": "[00:00.00]歌词内容\n[00:05.00]第二行歌词"
}
```

---

### 4. 用户认证

#### 用户注册

```http
POST /api/register
Content-Type: application/json
```

**请求体**:

```json
{
  "username": "用户名",
  "email": "user@example.com",
  "password": "密码"
}
```

---

#### 用户登录

```http
POST /api/login
Content-Type: application/json
```

**请求体**:

```json
{
  "email": "user@example.com",
  "password": "密码"
}
```

---

#### 修改密码

```http
POST /api/change-password
Content-Type: application/json
```

**请求体**:

```json
{
  "email": "user@example.com",
  "oldPassword": "旧密码",
  "newPassword": "新密码"
}
```

---

### 5. 收藏管理

#### 获取收藏列表

```http
GET /api/favorites?username={username}
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |

---

#### 添加收藏

```http
POST /api/favorites/add
Content-Type: application/json
```

**请求体**:

```json
{
  "username": "用户名",
  "song": {
    "filename": "song.mp3",
    "title": "歌曲名",
    "artist": "艺术家",
    "coverUrl": "/covers/song.jpg",
    "url": "/music/song.mp3",
    "duration": 180,
    "hasLyrics": true,
    "lrcUrl": "/lyrics/song.lrc"
  }
}
```

---

#### 移除收藏

```http
POST /api/favorites/remove
Content-Type: application/json
```

**请求体**:

```json
{
  "username": "用户名",
  "filename": "song.mp3"
}
```

---

### 6. 歌曲下载（Web 下载器）

#### 搜索歌曲

```http
GET /api/search-songs?keyword={keyword}
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 是 | 搜索关键词 |

---

#### 获取歌曲信息

```http
GET /api/song-info?id={id}
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 歌曲 ID |

---

#### 下载歌曲到服务器

```http
GET /api/download-song?id={id}
```

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 歌曲 ID |

---

## 状态码说明

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如文件已存在） |
| 500 | 服务器内部错误 |
