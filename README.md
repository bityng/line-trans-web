# 逐行翻译 · 网页服务端 (LineTrans Web)

**LineTrans 的网页端与局域网服务端**：在电脑、NAS 或服务器上跑起来，用浏览器继续 / 校对照翻译进度。

## 与安卓客户端的关系

本仓库只包含 **Web 服务端（含网页界面）**，安卓客户端在另一个仓库：
[line-trans-android](https://github.com/bityng/line-trans-android)。

- **line-trans-android**：安卓 App，内置同一个网页翻译台（手机开服务，局域网内其他设备用浏览器访问）
- **line-trans-web**（本仓库）：独立服务端，脱离手机也能用，适合在电脑上长时间翻译
- 两边**共用同一套网页界面与同一套 API**，网页体验一致；安卓仓库里的
  `app/src/main/assets/web/` 就是本仓库 `public/` 的副本

## 它是什么

不是给手机发 shell 命令的终端，而是一个**翻译编辑台**：

界面参考 DeepSeek Chat 的设计语言（白底分层、圆角卡片、`#4d6bfe` 主色、
左侧文档列表 + 中间编辑列 + 底部操作坞），支持浅色 / 深色 / 跟随系统主题（右上角齿轮 → 系统设置）。

- 左侧列出全部文档（进度、文件夹、置顶）
- 右侧逐句显示「原文 + 译文」卡片，直接在浏览器里编辑、自动保存
- 每句可单独 **AI 翻译**，也可以 **批量翻译剩余内容**（可随时停止）
- 支持收藏，按「全部 / 未完成 / 收藏」筛选，按原文或译文搜索
- 双击原文即可修改原文；支持逐行 / 逐句切换（按原文重新切分，保留已有译文）
- 导出对照 TXT / Markdown / CSV / JSON
- 所有改动实时写入数据文件；使用安卓内置服务时，手机与电脑共享同一份数据
- 安卓客户端在 [line-trans-android](https://github.com/bityng/line-trans-android)，
  它的 `app/src/main/assets/web/` 与本仓库 `public/` 保持一致

### 界面细节

- 左侧文档按**文件夹分组**，带进度与逐行 / 逐句标记；手机端是抽屉式侧栏
- 顶部有**进度环**与「跳转到第 N 句」，每句分成「原文 / 译文」两个区域，双击原文可直接编辑
- **长文档分窗口渲染**：每批 60 句、滚动到底自动加载，上千句也不卡
- 逐句 / 逐行切分与安卓端规则一致（缩写、小数点、网址、软换行合并、省略号等）

## 快速开始

需要 **Node.js 18+**，零依赖，不需要 `npm install`。

```
# 1. 准备配置
cp config.example.json config.json        # Windows: copy config.example.json config.json
# 编辑 config.json，填入 provider.baseUrl / apiKey / model 后即可使用 AI 翻译

# 2. 启动
npm start                                 # 等同于 node server.js
```

启动后终端会打印访问地址：

```
LineTrans 网页翻译台 v1.4.0 已启动
  本机：  http://127.0.0.1:8787/
  局域网：http://192.168.1.10:8787/
  数据：  ./data/state.json
```

浏览器打开即可开始翻译，手机浏览器同样可以访问。

### 导入自己的文本

首次启动时，`docs/` 目录下的 `*.txt` / `*.md` / `*.srt` / `*.csv` 会被自动导入成文档，
并做智能清理（去掉字幕时间轴、序号行与 Markdown 标记）。

也可以把安卓端「设置 → 数据 → 导出备份」得到的内容直接放到 `data/state.json` 位置继续翻译。

## 配置说明（config.json）

| 字段 | 说明 |
| --- | --- |
| `host` / `port` | 监听地址与端口，默认 `0.0.0.0:8787` |
| `token` | 访问令牌，填写后所有请求都要带 `?token=xxx`（局域网内建议设置） |
| `targetLang` / `sourceLang` / `detectLanguage` | 目标语言、源语言与自动检测 |
| `systemPrompt` | 系统提示词，支持 `{sourceLang}` `{targetLang}` `{docName}` `{mode}` `{glossary}` |
| `glossary` | 术语表，每行一条 `原文=译文`，翻译时强制使用 |
| `contextUnits` | 携带前文参考的句数 |
| `provider.type` | `openai`（OpenAI 兼容）或 `anthropic` |
| `provider.baseUrl` / `apiKey` / `model` | 接口地址、密钥与模型名 |
| `provider.inputPrice` / `outputPrice` | 每百万 token 价格，用于费用估算（可留 0） |

也可以用环境变量覆盖：`LT_HOST`、`LT_PORT`、`LT_TOKEN`。

## HTTP API

网页端与安卓客户端使用完全相同的接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/info` | 服务信息（版本、目标语言、模型、文档数） |
| GET | `/api/docs` | 文档列表（含进度） |
| GET | `/api/doc?id=ID` | 文档详情（含全部句子） |
| POST | `/api/unit` | 保存句子：`{docId,index,translation?,source?,done?,starred?}` |
| POST | `/api/doc` | 修改文档：`{docId,name?,folder?,pinned?,unitMode?}` |
| POST | `/api/ai` | 翻译一句：`{docId,index}` |
| GET | `/api/export?id=ID&format=txt_bilingual` | 导出：`txt_bilingual` / `txt_translated` / `txt_source` / `md` / `csv` / `json` |

## 部署到服务器（可选）

```
# 后台运行
nohup node server.js > lt.log 2>&1 &

# systemd：/etc/systemd/system/line-trans-web.service
[Unit]
Description=LineTrans Web
After=network.target

[Service]
WorkingDirectory=/opt/line-trans-web
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 许可

[MIT License](LICENSE)
