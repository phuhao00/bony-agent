========================================
   AI Agent 内容生产数字员工
   Windows 部署指南
========================================

【系统要求】
- Windows 10/11 64位
- Python 3.10 或更高版本（https://www.python.org/downloads/）
- Node.js 18 或更高版本（https://nodejs.org/）
- 至少 4GB 内存

【一键部署（推荐）】

  只需两步：

  1. 安装 Python 3.10+ 和 Node.js 18+（安装时勾选 "Add to PATH"）
  2. 双击项目根目录的 start_windows.bat

  脚本将自动完成：
  ✔ 检测运行环境  ✔ 创建虚拟环境  ✔ 安装 Python 依赖
  ✔ 安装 Playwright 浏览器  ✔ 安装前端依赖并构建
  ✔ 启动后端 + 前端  ✔ 自动打开浏览器

  首次运行约需 5-15 分钟（取决于网络速度）。
  后续运行会复用已有环境，约 30 秒内启动完毕。

【分步操作（高级用户）】

- install.bat      : 仅安装依赖（不启动服务）
- windows\start.bat: 仅启动服务（需先运行 install.bat）
- windows\stop.bat : 停止所有服务

【访问地址】

- 前端界面: http://localhost:3000
- 后端API: http://localhost:8000
- API文档: http://localhost:8000/docs

【常见问题】

Q: 启动报错 "ZHIPUAI_API_KEY not found"
A: 请在 backend\.env 文件中配置你的智谱AI密钥

Q: 浏览器登录功能无法使用
A: 运行 install.bat 重新安装 Playwright 浏览器

Q: 端口被占用
A: 运行 stop.bat 停止服务后重试

【技术支持】

项目地址: https://github.com/your-repo/agent
