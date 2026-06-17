# 🚀 5分钟快速配置GitHub OAuth授权

## 为什么选择GitHub？

- ✅ **最简单**：个人账号就能申请，无需企业资质
- ✅ **最快速**：5分钟搞定，无需审核
- ✅ **免费**：完全免费
- ✅ **稳定**：GitHub OAuth非常成熟可靠

## 📋 配置步骤

### 第1步：创建OAuth应用（2分钟）

1. **登录GitHub**
   - 访问：https://github.com/settings/developers
   - 或者：GitHub右上角头像 → Settings → Developer settings → OAuth Apps

2. **点击"New OAuth App"**

3. **填写应用信息**：
   ```
   Application name: AI Media Agent
   (或者任意名字，如：我的内容发布助手)
   
   Homepage URL: http://localhost:3000
   
   Application description: (可选)
   内容生产与分发工具
   
   Authorization callback URL: http://localhost:3000/api/connectors/oauth/callback
   ⚠️ 这个必须填对！
   ```

4. **点击"Register application"**

5. **获取凭证**：
   - 创建成功后，页面会显示 **Client ID**
   - 点击"Generate a new client secret"生成 **Client Secret**
   - ⚠️ **立即复制保存**，一旦离开页面就看不到了！

### 第2步：配置到代码（1分钟）

1. **打开配置文件**：
   ```bash
   cd /Users/tutu/Downloads/agent
   vi utils/oauth_manager.py
   ```

2. **找到GitHub配置**（大约第25行）：
   ```python
   "github": {
       "client_id": "YOUR_GITHUB_CLIENT_ID",  # ← 粘贴你的Client ID
       "client_secret": "YOUR_GITHUB_CLIENT_SECRET",  # ← 粘贴你的Client Secret
       ...
   }
   ```

3. **替换占位符**：
   ```python
   "github": {
       "client_id": "Ov23li1a2b3c4d5e6f7g",  # ← 例如这样
       "client_secret": "abc123def456ghi789jkl",  # ← 例如这样
       ...
   }
   ```

4. **保存文件**

### 第3步：重启服务（30秒）

```bash
# 在终端按 Ctrl+C 停止当前服务

# 重新启动
./start_local.sh
```

### 第4步：测试授权（1分钟）

1. **打开浏览器**：
   ```
   http://localhost:3000/platforms
   ```

2. **找到GitHub平台**，点击"立即授权"

3. **授权窗口弹出**：
   - 显示GitHub登录页面
   - 登录你的GitHub账号（如果未登录）
   - 点击"Authorize"授权

4. **完成！** 窗口自动关闭，主页面显示"已授权"

## 🎉 成功效果

授权成功后，您会看到：
- ✅ GitHub卡片显示"已授权"状态
- ✅ 显示你的GitHub用户名
- ✅ 显示你的头像
- ✅ 显示你的粉丝数

## 🔧 完整配置示例

```python
# utils/oauth_manager.py

"github": {
    "client_id": "Ov23liAbCdEfGhIjKlMn",  # 你的真实Client ID
    "client_secret": "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",  # 你的真实Client Secret
    "authorize_url": "https://github.com/login/oauth/authorize",
    "token_url": "https://github.com/login/oauth/access_token",
    "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
    "scope": "read:user user:email"
},
```

## ❓ 常见问题

**Q: 我没看到Client Secret？**
A: Client Secret只显示一次。点击"Generate a new client secret"重新生成。

**Q: 回调URL填错了怎么办？**
A: 回到GitHub OAuth App设置页面修改即可。

**Q: 授权后能做什么？**
A: 目前主要用于演示OAuth流程。未来可以集成GitHub相关功能（如发布到GitHub Pages等）。

**Q: 生产环境怎么配置？**
A: 将所有 `localhost:3000` 改为你的实际域名即可。

**Q: 可以撤销授权吗？**
A: 可以！在 https://github.com/settings/applications 撤销。

## 🎯 下一步

配置成功后，您可以：
1. ✅ 体验完整的OAuth授权流程
2. ✅ 理解OAuth的工作原理
3. ⭐ 按照类似流程配置Google OAuth（适用于YouTube）
4. ⭐ 适配其他平台

## 📚 相关文档

- GitHub OAuth文档：https://docs.github.com/en/apps/oauth-apps
- 完整实现指南：`docs/OAUTH_IMPLEMENTATION_GUIDE.md`

---

**配置GitHub OAuth只需5分钟！现在就试试吧！** 🚀
