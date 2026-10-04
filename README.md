# 逐行翻译 · 网页服务端 (LineTrans Web)

**LineTrans 的网页端与局域网服务端**：在电脑、NAS 或服务器上跑起来，用浏览器继续 / 校对照翻译进度。

## 最近更新

### v1.8.3

- **修复：POST 请求体一律按 UTF-8 解码**。此前 `readBody()` 用 `data += chunk` 累加，每个 TCP 分块各自解码，
  一个多字节汉字正好被切在分块边界上就会变成 `U+FFFD`；现在先收 `Buffer`，最后一次性 `toString('utf8')`
- **修复：网页台发 POST 时请求头带 `charset=utf-8`**。安卓端内置网页台跑在 NanoHTTPD 上，请求头不声明 charset
  时它按 **US-ASCII** 解请求体，中文会变成**不可逆**的乱码（表现为「在网页台输完、回到安卓端全是乱码」）；
  两端服务端都按 UTF-8 兜底，浏览器缓存着旧界面也不会写坏数据
- 与安卓端内置网页台同步（`app/src/main/assets/web/` 与本仓库 `public/` 逐字节一致）

### v1.8.1

- **修复**：移除网页台侧栏页脚里的「Shell 终端」链接。该功能的后端路由已在 v1.8.0 删除，前端链接却残留，点击是 404 死链，与 v1.8.0 发行说明自相矛盾
- 与安卓端内置网页台同步（`app/src/main/assets/web/` 与本仓库 `public/` 逐字节一致）

### v1.8.0

- 新增**划词查义**：点原文 / 译文里的单词即弹出释义浮层（词形还原、来源徽章、我的词库、AI 兜底可开关）
- 新增接口 `GET /api/lookup`（查词）与 `GET /api/dict`（词库状态）
- 随仓库分发离线词库：`dict/core.tsv`（4 万词）+ `dict/lemma.tsv`（10.2 万条词形还原），查词不联网、秒出
- 新增配置项 `definitionLanguage`（zh / both / en）与 `lookup.aiFallback`
- **修复**：`lemma.tsv` 原形列整列丢失 —— 生成脚本把源文件格式解析反了，导致 8.4 万行全是废数据、词形还原彻底失效；修正后可用映射从 **0 恢复到 101,909** 条

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
- **划词查义**：点原文 / 译文里的单词即弹释义浮层，用的是随仓库分发的离线词库（ECDICT），不联网、秒出
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
LineTrans 网页翻译台 v1.8.1 已启动
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
| `definitionLanguage` | 划词查义的释义语言：`zh`（默认）/ `both` / `en`，非法值按 `zh` |
| `lookup.aiFallback` | 本地词库没查到词时是否用 AI 兜底生成释义，默认 `false`（需先配好 `provider`） |
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
| GET | `/api/lookup?word=WORD&lang=zh&ai=1` | 划词查义：查离线词库，可选 AI 兜底（见下方「划词查义」） |
| GET | `/api/dict` | 离线词库状态：`{ok,ready,entries,lemma,imported}` |

## 划词查义（离线词库）

在原文或译文里点一个单词，就会在该词上方弹出释义浮层。释义来自**随仓库一起分发的离线词库**，
不联网、秒出，跟安卓端用的是同一份数据。

### 词库文件

| 文件 | 说明 |
| --- | --- |
| `dict/core.tsv` | 常用词条 4 万条，每行 `单词 \t 音标 \t 中文释义` |
| `dict/lemma.tsv` | 词形还原表，每行 `变形 \t 原形`（`ran → run`、`went → go`） |
| `dict/dict-import.tsv` | **可选**，自己导入的词典，格式同 `core.tsv`；同名条目会覆盖内置词条，改完重启生效 |

- 数据来源：[ECDICT](https://github.com/skywind3000/ECDICT)（**MIT 许可**），由安卓仓库的
  `tools/build-local-dict.mjs` 从 `ecdict.csv` + `lemma.en.txt` 生成。
  本项目代码遵循 AGPL-3.0-or-later，**词典数据部分仍遵循 MIT**。
- 与安卓端 `app/src/main/assets/dict/` 是同一份文件，查询语义（直接命中 → 词形还原 → 规则变形）
  与安卓 `LocalDictionary` 完全一致。
- 词库在**首次调用 `/api/lookup` 或 `/api/dict` 时懒加载**（本机实测 1~3 秒，取决于磁盘），之后常驻内存；
  文件缺失不会让服务崩溃，只是查不到词 —— `/api/dict` 会返回 `ready:false` 并带 `error` 说明。

### 查词顺序

1. `dict/dict-import.tsv` 用户导入词典（覆盖内置条目）→ `source:"import"`
2. `dict/core.tsv` 直接命中 → `via:"direct"`，`source:"local"`
3. `dict/lemma.tsv` 词形还原后命中原形 → `via:"lemma"`
4. 规则变形（`ies / es / s / ing / ed / er / est / ly`）后命中 → `via:"variant"`
5. 仍未命中、且允许 AI 兜底、且已配置 `provider` → 让模型给中文释义 → `source:"ai"`
6. 否则 `found:false`，`source:"none"`

### GET /api/lookup

| 参数 | 说明 |
| --- | --- |
| `word` | 必填。服务端会清洗：去首尾空白 → 去掉首尾既不是字母、也不是 `-` 或 `'` 的字符 → 转小写；超过 64 个字符截断 |
| `lang` | 可选，`zh`（默认）/ `both` / `en`，非法值按 `zh`；不传则用配置 `definitionLanguage` |
| `ai` | 可选，`1` 允许 AI 兜底、`0` 禁止；不传则用配置 `lookup.aiFallback`（默认 `false`） |

> 本地词库只存了中文释义，所以 `lang` 只影响 AI 兜底的输出语言，本地命中时始终返回中文释义。

命中（`matched` 是真正命中的词条，`via` 说明是怎么命中的）：

```json
{ "ok":true, "word":"ran", "found":true, "matched":"run", "via":"lemma",
  "phonetic":"rʌn", "meaning":"n. 跑, 赛跑…；run的过去式和过去分词", "source":"local" }
```

- `via`：`direct` / `lemma` / `variant`；AI 兜底时为 `ai`
- `source`：`local` / `import` / `ai` / `none`
- AI 兜底成功时额外带 `cost` 字段（与 `/api/ai` 同口径的费用估算）

未命中时 **HTTP 仍然是 200**：

```json
{ "ok":true, "word":"zzz", "found":false, "matched":null, "via":null, "source":"none" }
```

`word` 清洗后为空（例如只传了 `...`）：

```json
{ "ok":false, "error":"word 不能为空" }
```

### GET /api/dict

```json
{ "ok":true, "ready":true, "entries":40000, "lemma":101909, "imported":0 }
```

`entries` = `core.tsv` 词条数，`lemma` = 可用词形映射条数，`imported` = `dict-import.tsv` 条数（文件不存在时为 0）。
词库文件缺失时返回 `ready:false`，并多一个 `error` 字段说明缺了哪个文件。

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

**GNU Affero General Public License v3.0（AGPL-3.0-or-later）**，完整条款见 [LICENSE](LICENSE)。

因为本仓库是一个**网络服务**，按 AGPL 第 13 条，对外提供服务时需要让使用者能够获取到源码：
网页界面「系统设置 → 关于」中已列出两个仓库地址，二次开发时请保留该入口。
