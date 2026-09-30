# AGENTS.md · 网页服务端

> 给 AI 助手 / 新同学的入口文件。完整背景、架构、坑位清单与 Roadmap 见
> [`F:\逐行翻译\项目说明与开发指南.md`](file:///F:/%E9%80%90%E8%A1%8C%E7%BF%BB%E8%AF%91/%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E%E4%B8%8E%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md)。

## 这是什么

LineTrans 的网页端 / 局域网服务端：**零依赖 Node.js**，在浏览器里继续逐行翻译。
与安卓客户端（line-trans-android）**共用同一套网页界面与 HTTP API**。

## 硬性约定

- 许可：**AGPL-3.0-or-later**；不要删除界面「系统设置 → 关于」里的仓库入口（AGPL 第 13 条）。
- `public/` 与安卓仓库的 `app/src/main/assets/web/` 必须保持一致 —— 改一份就同步另一份。
- 新增静态资源要同时加到本仓库 `public/` 与 `server.js` 的 `STATIC_FILES`。
- 界面文案用中文。

## 关键实现点

| 位置 | 说明 |
| --- | --- |
| `server.js` `splitSentences()` | 逐句切分，规则必须与安卓 `util/TextParser.kt` 一致（见项目文档 §5） |
| `server.js` `handleApi()` | 全部 API：`/api/info`、`/api/docs`、`/api/doc`、`/api/unit`、`/api/ai`、`/api/export` |
| `public/app.js` | 分窗口渲染（每批 60 句，IntersectionObserver 续加载）——**不要改成一次性全渲染** |
| `public/style.css` | 设计变量 + `[hidden] { display: none !important }`（删了设置弹窗会常驻） |

## 运行与自检

```bash
cp config.example.json config.json   # 填 provider.baseUrl / apiKey / model
npm start                            # http://127.0.0.1:8787/
node --check server.js && node --check public/app.js
```

API 快速自检：

```bash
curl localhost:8787/api/info
curl localhost:8787/api/docs
curl -X POST localhost:8787/api/doc -H 'Content-Type: application/json' -d '{"docId":"<id>","unitMode":"SENTENCE"}'
```
