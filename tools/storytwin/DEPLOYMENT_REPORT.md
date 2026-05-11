# StoryTwin 部署完成报告

## ✅ 部署状态

**服务名称**: StoryTwin  
**服务状态**: ✅ 运行中  
**端口**: 8001  
**位置**: `/root/.openclaw/workspace/portfolio/tools/storytwin.html`

## 📍 访问地址

### 本地访问
- **工具页面**: http://localhost:8001
- **API 文档**: http://localhost:8001/docs

### 线上访问（配置 Nginx 后）
- **工具页面**: https://lizhimu.cn/tools/storytwin.html

## 🔧 Nginx 配置

### 1. 编辑 Nginx 配置

```bash
sudo nano /etc/nginx/sites-available/lizhimu.cn
```

### 2. 添加反向代理配置

在现有的 server 块中添加：

```nginx
# StoryTwin 工具
location /tools/storytwin {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket 支持（如果需要）
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

### 3. 测试配置

```bash
# 测试 Nginx 配置
sudo nginx -t
```

### 4. 重启 Nginx

```bash
sudo systemctl reload nginx
```

## 🚀 服务管理

### 查看服务状态

```bash
# 查看进程
ps aux | grep "backend/main.py" | grep 8001

# 查看日志
tail -f /root/.openclaw/workspace/portfolio/tools/storytwin/storytwin.log
```

### 重启服务

```bash
# 停止旧进程
pkill -f "python3.*main.py.*8001"

# 启动新进程
cd /root/.openclaw/workspace/portfolio/tools/storytwin
nohup python3 backend/main.py > storytwin.log 2>&1 &
```

### 开机自启动（可选）

创建 systemd 服务：

```bash
sudo nano /etc/systemd/system/storytwin.service
```

添加内容：

```ini
[Unit]
Description=StoryTwin Audio Generator
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw/workspace/portfolio/tools/storytwin
Environment="PATH=/usr/bin:/usr/local/bin"
ExecStart=/usr/bin/python3 backend/main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable storytwin
sudo systemctl start storytwin
```

## 📊 功能测试

### 1. 测试 API

```bash
# 获取故事列表
curl http://localhost:8001/api/stories

# 获取声音选项
curl http://localhost:8001/api/voices

# 测试生成（需要 POST 数据）
curl -X POST http://localhost:8001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"story_id":"wolf","cn_voice":"zh-CN-XiaoyiNeural","en_voice":"en-US-JennyNeural"}'
```

### 2. 访问页面

浏览器访问：
- http://localhost:8001
- https://lizhimu.cn/tools/storytwin.html (Nginx 配置后)

### 3. 检查工具页面入口

访问 https://lizhimu.cn/tools.html  
确认 StoryTwin 卡片已添加

## 📁 文件结构

```
/root/.openclaw/workspace/portfolio/
├── tools.html                    # ✅ 已添加入口卡片
├── tools/
│   ├── storytwin.html            # ✅ 工具页面
│   └── storytwin/
│       ├── backend/
│       │   └── main.py           # ✅ FastAPI 后端
│       ├── index.html            # ✅ 前端页面
│       ├── requirements.txt      # ✅ Python 依赖
│       └── storytwin.log         # 📝 运行日志
```

## 🎯 已完成任务

- ✅ 重命名为 StoryTwin
- ✅ 部署到 portfolio 目录
- ✅ 启动服务（端口 8001）
- ✅ 创建工具页面（storytwin.html）
- ✅ 在 tools.html 添加入口卡片
- ⏳ 等待 Nginx 配置

## 📝 下一步

1. **配置 Nginx**（需要服务器权限）
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

2. **测试访问**
   - 访问 https://lizhimu.cn/tools/storytwin.html
   - 生成一个测试音频

3. **添加更多故事**（可选）
   - 三只小猪
   - 小红帽
   - 龟兔赛跑

## 🔍 故障排查

### 服务无法访问
```bash
# 检查端口
netstat -tlnp | grep 8001

# 检查进程
ps aux | grep "main.py"
```

### Nginx 502 错误
```bash
# 检查后端服务
curl http://localhost:8001/api/stories

# 重启服务
pkill -f "python3.*main.py.*8001"
cd /root/.openclaw/workspace/portfolio/tools/storytwin
nohup python3 backend/main.py > storytwin.log 2>&1 &
```

### 页面样式错误
- 检查 style.css 路径
- 清除浏览器缓存

---

**部署时间**: 2026-04-10 15:35  
**部署位置**: lizhimu.cn  
**版本**: 1.0.0
