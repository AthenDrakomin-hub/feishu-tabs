# 飞书/Lark 多账号容器 — 项目计划

> 版本 v1.4 · 2026-10-22（移除 AI 助手，专注核心功能）
> 技术路线：Electron 31 + WebContentsView + persist partition

---

## 1. 项目目标

单窗口多账号飞书/Lark 容器，账号隔离、切换不重载。

## 2. 技术栈

| 组件 | 版本 | 说明 |
|---|---|---|
| Electron | ^31.0.0 | WebContentsView 需 30+ |
| electron-builder | ^24.13.3 | portable 打包 |
| Node | 18+ | 零额外依赖 |

## 3. 目录结构

**应用目录**：
```
飞书多开/
├── main.js              # 主进程：窗口/视图/账号管理/菜单/快捷键
├── prompt-dialog.js     # 公共模态输入弹窗
├── accounts.json        # 首次启动默认模板
├── package.json
└── PLAN.md
```

**运行时数据（`%APPDATA%/飞书多账号/`）**：
```
├── accounts.json        # 账号配置
├── state.json           # { lastAccountId }
└── Partitions/          # 各账号登录态
```

## 4. 账号管理

| 操作 | 方式 |
|---|---|
| 添加 | 菜单「账号 → ＋ 添加账号」或 `Ctrl+Shift+N` |
| 切换 | 菜单或 `Ctrl+1..9`（第10个 `Ctrl+0`） |
| 重命名/删除 | 菜单对应项，删除会清除该账号登录态 |

| 操作 | 方式 |
|---|---|
| 添加 | 菜单「账号 → ＋ 添加账号」或 `Ctrl+Shift+N` |
| 切换 | 菜单或 `Ctrl+1..9`（第10个 `Ctrl+0`） |
| 重命名/删除 | 菜单对应项，删除会清除该账号登录态 |
| AI 助手 | `Ctrl+Shift+A` 或菜单「视图 → AI 话术助手」 |

## 5. 本地运行与打包

```powershell
cd C:\Users\88903\Desktop\飞书多开
npm install
npm start          # 开发运行
npm run dist       # 打包 portable exe
```

## 6. 测试验收清单

### 7.1 静态校验（已通过）
- [x] 6 个 JS 文件 `node --check` 通过
- [x] JSON 合法
- [x] code-review 扫描 0 must_fix / 0 High

### 7.2 已修复缺陷
- [x] **M1** `closeView()` currentId 过早置空 → 先确认 next，再置 null，防止 switchTo 误删已销毁视图
- [x] **L1** `isTrustedUrl` 权限白名单过窄 → 增加 `includes('feishu.cn')` / `includes('larksuite.com')` 覆盖 auth 子域
- [x] `accounts.json` 模板清理 → 移除日本 Lark 预填账号，改为国内飞书 messenger 入口

### 7.2 功能验收
| # | 用例 | 预期 | 优先级 |
|---|---|---|---|
| T1 | 多账号登录切换不重载 | 页面状态保留 | P0 |
| T2 | 动态增删账号 + 持久化 | 重启保留 | P0 |
| T3 | M4 保活实测 | 隐藏账号静置后能收消息 | P0 |

## 7. 已知风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| M4 隐藏账号停推送 | P0 待实测 | 失败则注入 visibility 伪造 |

## 8. 分阶段落地

| 阶段 | 任务 | 验收 |
|---|---|---|
| D1 | npm install + 多账号跑通 | T1/T2 |
| D2 | M4 保活实测 | T3 |
| D3 | 全量验收 + portable 打包 | 全部 P0 |

## 9. 部署与回滚

- 分发：portable exe 双击运行，免安装。
- 数据：`%APPDATA%/飞书多账号/`，含账号、AI 配置、企业知识库缓存。
- 回滚：替换 exe 即可，数据独立保留。
