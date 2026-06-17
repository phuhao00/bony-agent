# OAuth授权连接 - 实现指南

## 概述

我已经将平台连接功能重新设计为**标准的OAuth授权流程**，用户可以通过跳转到第三方平台官方授权页面来安全地连接账号。

##  授权流程

```
1. 用户点击"立即授权"按钮
   ↓
2. 前端请求后端生成OAuth授权URL
   ↓
3. 后端生成授权URL（带state防CSRF）
   ↓
4. 前端在新窗口打开授权页面
   ↓
5. 用户在第三方平台登录并授权
   ↓
6. 第三方平台回调到我们的callback URL（携带授权码）
   ↓
7. 后端用授权码换取访问令牌
   ↓
8. 保存令牌并获取用户信息
   ↓
9. 授权成功页面显示，窗口自动关闭
   ↓
10. 主页面自动刷新，显示已连接状态
```

## 已完成的文件

### 前端

1. **`web/app/platforms/page.tsx`**
   - 全新的OAuth授权界面
   - 点击"立即授权"打开授权窗口
   - 实时显示连接状态
   - 账号信息展示（头像、用户名、粉丝数）

2. **`web/app/api/connectors/oauth/authorize/[platform]/route.ts`**
   - 请求后端生成授权URL
   - 返回给前端在新窗口打开

3. **`web/app/api/connectors/oauth/callback/route.ts`**
   - 处理OAuth回调
   - 显示美观的授权成功/失败页面
   - 通过postMessage通知父窗口
   - 自动关闭授权窗口

### 后端

1. **`utils/oauth_manager.py`**
   - 完整的OAuth管理器
   - 支持8个主流平台的OAuth配置
   - 生成授权URL（带state和PKCE）
   - 处理回调并换取token
   - 自动获取用户信息
   -刷新token功能

2. **`server.py`** (新增API端点)
   ```python
   GET  /connectors/oauth/authorize/{platform}  # 生成授权URL
   POST /connectors/oauth/callback              # 处理OAuth回调
   ```

3. **`tools/connectors/manager.py`** (更新)
   - 添加 `supports_oauth` 字段
   - 标识哪些平台支持OAuth

## 支持的平台

| 平台 | OAuth支持 | 状态 |
|------|----------|------|
| 小红书 | ✅ 是 | 需配置Client ID/Secret |
| 抖音 | ✅ 是 | 需配置Client Key/Secret |
| 微博 | ✅ 是 | 需配置App Key/Secret |  
| X (Twitter) | ✅ 是 | 需配置Client ID/Secret |
| YouTube | ✅ 是 | 需配置Google Client ID/Secret |
| Meta | ✅ 是 | 需配置App ID/Secret |
| B站 | ❌ 否 | 使用Cookie登录 |
| 视频号 | ❌ 否 | 使用扫码登录 |

## 配置方法

### 1. 获取各平台的OAuth凭证

每个平台都需要在其开发者平台注册应用并获取凭证：

#### 小红书
1. 访问：https://edith.xiaohongshu.com/developer
2. 创建应用
3. 获取：App ID和App Secret
4. 配置回调URL：`http://localhost:3000/api/connectors/oauth/callback`

#### 抖音
1. 访问：https://developer.open-douyin.com/
2. 创建网站应用
3. 获取：Client Key和Client Secret
4. 配置回调地址：`http://localhost:3000/api/connectors/oauth/callback`

#### 微博
1. 访问：https://open.weibo.com/
2. 创建移动应用或网站应用
3. 获取：App Key和App Secret
4. 配置授权回调页：`http://localhost:3000/api/connectors/oauth/callback`

#### X (Twitter)
1. 访问：https://developer.twitter.com/
2. 创建App
3. 启用OAuth 2.0
4. 获取：Client ID和Client Secret
5. 配置Callback URLs

#### YouTube (Google)
1. 访问：https://console.cloud.google.com/
2. 创建OAuth 2.0凭据
3. 获取：Client ID和Client Secret
4. 配置授权重定向URI

### 2. 配置凭证

编辑 `utils/oauth_manager.py`，将获取到的凭证填入：

```python
OAUTH_CONFIGS = {
    "xiaohongshu": {
        "client_id": "YOUR_XHS_APP_ID",  # ← 填入小红书App ID
        "client_secret": "YOUR_XHS_APP_SECRET",  # ← 填入小红书App Secret
        # ...
    },
    # ...其他平台
}
```

### 3. 配置回调URL

生产环境部署时，需要将回调URL改为实际域名：

```python
# 开发环境
"redirect_uri": "http://localhost:3000/api/connectors/oauth/callback"

# 生产环境
"redirect_uri": "https://yourdomain.com/api/connectors/oauth/callback"
```

## 使用方法

### 用户操作流程

1. 访问：http://localhost:3000/platforms
2. 找到要连接的平台
3. 点击"立即授权"按钮
4. 在弹出窗口中登录第三方平台
5. 确认授权
6. 自动返回，连接完成！

### 开发者测试

```bash
# 1. 启动后端
cd /Users/tutu/Downloads/agent
./start_local.sh

# 2. 访问平台管理页面
open http://localhost:3000/platforms

# 3. 点击任意平台的"立即授权"按钮
# 注意：需要先配置该平台的OAuth凭证
```

## 安全特性

### 1. State参数防CSRF
每次授权都生成随机state，防止跨站请求伪造攻击

### 2. PKCE保护
对于公共客户端（如移动端），使用PKCE增强安全性

### 3. 加密存储
访问令牌加密存储在 `platform_credentials.json`

### 4. 自动刷新
支持使用refresh_token自动刷新访问令牌

## API文档

### 生成授权URL

```http
GET /connectors/oauth/authorize/{platform}
```

**响应示例：**
```json
{
  "authorization_url": "https://api.weibo.com/oauth2/authorize?client_id=xxx&...",
  "state": "random_state_string"
}
```

### 处理回调

```http
POST /connectors/oauth/callback
Content-Type: application/json

{
  "platform": "weibo",
  "code": "authorization_code",
  "state": "random_state_string"
}
```

**响应示例：**
```json
{
  "success": true,
  "account": {
    "username": "example_user",
    "name": "示例用户",
    "avatar": "https://...",
    "followers": 10000,
    "user_id": "123456"
  }
}
```

## 错误处理

### 用户取消授权
- 显示"授权失败"页面
- 提示用户可重新尝试

### Token换取失败
- 显示错误详情
- 建议用户重新授权

### State验证失败
- 拒绝请求，提示安全错误
- 记录日志用于审计

## 下一步工作

### 必须完成（才能使用）
- [ ] 为每个平台注册开发者应用
- [ ] 获取OAuth凭证(Client ID/Secret)
- [ ] 填入 `oauth_manager.py` 配置

### 可选优化
- [ ] 实现token自动刷新定时任务
- [ ] 添加账号切换功能
- [ ] 支持企业号/个人号区分
- [ ] 增加权限范围选择
- [ ] 添加授权记录审计日志

## 常见问题

**Q: 为什么点击授权后没有反应？**
A: 检查浏览器是否拦截了弹出窗口。建议允许弹窗或手动打开授权URL。

**Q: 授权成功但没有保存？**
A: 检查 `platform_credentials.json` 文件权限，确保应用有写入权限。

**Q: 如何撤销授权？**
A: 点击"取消授权"按钮，或在第三方平台的账号设置中撤销。

**Q: 生产环境如何部署？**
A: 需要将所有 `localhost:3000` 改为实际域名，并在各平台重新配置回调URL。

**Q: Token过期了怎么办？**
A: 系统会自动使用refresh_token刷新。如果刷新失败，需要重新授权。

## 总结

现在平台连接使用的是**标准OAuth 2.0授权流程**：
- ✅ 安全可靠，使用官方授权
- ✅ 用户体验好，无需记住复杂的API密钥
- ✅ 符合各平台的官方规范
- ✅ 支持自动刷新token
- ✅ 完整的错误处理和用户反馈

配置好各平台的OAuth凭证后，用户只需点击一次" 即可完成连接！🎉
