# Contributing to Figma Android MCP

感谢你对 Figma Android MCP 项目的关注！这份指南将帮助你了解如何参与贡献。

## 项目定位

本项目是 [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) 的 Android 定制分支，已演进为独立的 MCP 服务。核心特性包括：

- **Android 原生输出** — 通过 `--output-platform` 支持 Compose 和 Views/XML 两种布局术语
- **多密度图片下载** — 集成 Jimp，按 Android 密度桶（mdpi/xhdpi/xxhdpi）下载并裁剪图片
- **设计密度自动检测** — 根据 Frame 宽度自动推断设计稿密度，dp/sp 值和图片下载自适应
- **技能系统** — 通过 Markdown 技能文件约束 AI 代码生成质量，支持 `_REQUIRED_RULES` 机制
- **Section 多状态支持** — 自动识别 Section 节点，将多状态 Frame（default/loading/error/empty/success）分组返回
- **截图预览** — 可选获取节点渲染截图，方便 AI 对照校验
- **统一路由** — `get_figma_node` 自动检测节点类型并路由到正确管线
- **双认证** — 同时支持 Personal Access Token 和 OAuth Bearer Token；HTTP 模式支持 `X-Figma-Token` 请求头

## 开发准备

### 环境要求

- Node.js >= 20.20.0
- pnpm 10.x（项目使用 `pnpm@10.10.0`）
- Figma API access token（[创建方式](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)）

### 快速开始

```bash
git clone <repo-url>
cd figma-android-mcp
pnpm install
pnpm build
pnpm test
```

### 本地调试

创建 `.env` 文件：

```
FIGMA_API_KEY=your_figma_api_key_here
```

启动开发模式：

```bash
pnpm dev              # HTTP 模式（watch + 自动重启）
pnpm dev:cli          # stdio 模式
```

在 MCP 客户端配置中连接本地服务器：

```json
"mcpServers": {
  "figma-android-mcp": {
    "url": "http://localhost:3333/mcp"
  }
}
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式（watch + 自动重启，HTTP） |
| `pnpm dev:cli` | 开发模式（stdio） |
| `pnpm build` | 生产构建 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm test` | 运行测试 |
| `pnpm test -- path/to/test.ts` | 运行单个测试文件 |
| `pnpm test -- --testNamePattern="pattern"` | 按名称过滤测试 |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm inspect` | MCP Inspector 调试 |
| `pnpm benchmark:simplify` | 简化管线性能基准测试 |

## 项目结构

```
src/
├── bin.ts                      # CLI 入口（cleye 参数解析）
├── config.ts                   # 配置管理（CLI 参数 + 环境变量三层优先级）
├── server.ts                   # 服务器初始化（stdio / HTTP）
├── index.ts                    # 库导出（extractors, types）
├── mcp-server.ts               # MCP 服务器工厂函数
├── commands/
│   └── fetch.ts                # CLI fetch 子命令
├── mcp/
│   ├── index.ts                # MCP 工具注册入口
│   ├── tools/                  # MCP 工具定义与处理器
│   │   ├── get-figma-data-tool.ts       # 获取 Figma 文件/节点设计数据
│   │   ├── get-figma-node-tool.ts       # 统一入口：自动检测节点类型并路由
│   │   ├── get-figma-section-tool.ts    # 获取 Section 下所有 Frame（多状态）
│   │   ├── download-figma-images-tool.ts # 多密度图片下载
│   │   ├── get-skill-tool.ts            # 技能查询
│   │   └── index.ts
│   ├── resources/
│   │   └── skills-resource.ts   # 技能 MCP Resource 注册
│   ├── progress.ts              # 进度通知 heartbeat
│   └── validation-capture.ts    # 参数校验捕获
├── services/
│   ├── figma.ts                 # Figma REST API 客户端（认证、请求分发）
│   ├── get-figma-data.ts        # get_figma_data 核心逻辑
│   ├── get-figma-section.ts     # get_figma_section 核心逻辑
│   ├── download-figma-images.ts # 图片下载 + 去重 + 密度桶分发
│   └── errors/                  # 错误类型（限流、权限等）
│       ├── forbidden.ts
│       ├── rate-limit.ts
│       └── index.ts
├── extractors/
│   ├── design-extractor.ts      # 提取器入口，解析 API 响应
│   ├── node-walker.ts           # 递归节点遍历，应用 extractor + afterChildren
│   ├── built-in.ts              # 内置提取器（layout/text/visuals/component）
│   ├── types.ts                 # ExtractorFn, GlobalVars, TraversalContext 等类型
│   └── index.ts
├── transformers/
│   ├── layout.ts                # 布局属性转换（位置、尺寸、Auto Layout）
│   ├── style.ts                 # 样式转换（填充色、描边、渐变）
│   ├── effects.ts               # 效果转换（阴影、模糊）
│   ├── text.ts                  # 文本内容与样式（rich text、inline style override）
│   ├── component.ts             # 组件元数据（属性、变体、引用）
│   └── region-hints.ts          # 区域提示（响应式布局规则）
├── platform-mappers/            # Android 平台输出映射
│   ├── compose.ts               # Compose 术语（arrangement, alignment, spacing...）
│   ├── views.ts                 # Views/XML 术语（gravity, layout_width, orientation...）
│   ├── types.ts                 # 共享类型
│   └── index.ts
├── skills/
│   ├── built-in.ts              # 内置技能（随代码打包）
│   ├── loader.ts                # 技能加载器（文件系统 + 去重 + override）
│   ├── types.ts                 # Skill, SkillMeta 类型
│   └── index.ts
├── telemetry/
│   ├── client.ts                # 遥测客户端初始化
│   ├── capture.ts               # 事件捕获
│   ├── types.ts                 # 事件类型
│   └── index.ts
└── utils/
    ├── image-processing.ts      # Jimp 图片处理（裁剪、格式转换、缩放）
    ├── dedup-images.ts          # 图片去重（按内容 hash）
    ├── figma-url.ts             # Figma URL 解析
    ├── common.ts                # 通用工具（varId 生成、文件名、isVisible）
    ├── units.ts                 # dp/sp 单位转换、密度常量
    ├── local-path.ts            # 路径安全校验（防目录穿越）
    ├── proxy-env.ts             # 代理环境检测
    ├── identity.ts              # 类型守卫（hasValue, isRectangleCornerRadii 等）
    ├── fetch-json.ts            # HTTP 请求封装
    ├── serialize.ts             # 序列化工具
    ├── logger.ts                # 日志工具
    └── error-meta.ts            # 错误元数据提取
```

## 核心设计

### 数据流

1. **MCP Tools** — 接收客户端请求，Zod Schema 校验参数
2. **Figma Service** — 调用 Figma REST API（`/v1/files/{key}`、`/v1/files/{key}/nodes`、`/v1/images/{key}`），处理认证和请求
3. **Extractors** — 遍历节点树，提取布局、文本、样式、组件信息；`afterChildren` 钩子支持后处理（如栅格容器折叠）
4. **Transformers** — 将 Figma 原始属性转换为结构化数据（layout/style/effects/text/component）
5. **Platform Mappers** — 将布局术语映射为 Android 原生表达（Compose / Views）

### 平台映射器

`platform-mappers/` 目录包含两种 Android 输出模式：

- **compose**（默认）— Jetpack Compose 布局术语：`layout`（Column/Row/Box）、`arrangement`、`alignment`、`spacing`、`width`、`height`
- **views** — 传统 XML/View 布局术语：`orientation`、`gravity`、`layout_width`、`layout_height`

新增平台支持时，在 `platform-mappers/` 下添加新的映射器并注册到 `index.ts`。

### 技能系统

技能是 YAML frontmatter + Markdown 正文的文档文件，存放在 `.claude/skills/`（或 `--skills-dir` 指定）目录下。技能加载顺序：内置技能（`src/skills/built-in.ts`）→ 用户自定义技能（同名覆盖）。

MCP 工具 `get_skill` 提供技能查询；`get_figma_data` / `get_figma_node` 输出的 `_REQUIRED_RULES` 字段会引用相关技能的 `skill://` 资源 URI，AI 在生成代码前应读取这些资源。

技能 frontmatter 格式：

```yaml
---
name: skill-name
title: 技能标题
description: 技能说明
category: layout  # 可选
instructions: 何时触发此技能  # 可选
triggers:  # 可选，触发关键词列表
  - 关键词1
  - 关键词2
---
技能正文（Markdown）
```

### 设计密度

服务端通过 `--design-density` 配置设计密度，决定 dp/sp 转换比例。当设为 `auto`（默认）时，`get_figma_data` 根据 Frame 宽度自动推断：≤480px → mdpi（1×），≤768px → xhdpi（2×），>768px → xxhdpi（3×）。

### 提取器系统

内置四个提取器，按 `allExtractors` 组合运行：

| 提取器 | 职责 |
|--------|------|
| `layoutExtractor` | 位置、尺寸、Auto Layout、间距、对齐 |
| `textExtractor` | 文本内容（含 rich text + inline style override）、文本样式（字号 sp、字重、颜色、行高） |
| `visualsExtractor` | 填充色、描边、圆角（自动 clamp 到 min(width,height)/2）、透明度、阴影/模糊、图片填充检测 |
| `componentExtractor` | 组件 ID、属性值、属性引用、属性定义（含变体选项） |

组合导出：`allExtractors`、`layoutAndText`、`contentOnly`、`visualsOnly`、`layoutOnly`。

## 配置参考

配置优先级：**CLI 参数 > 环境变量 > 默认值**。

| CLI 参数 | 环境变量 | 默认值 | 说明 |
|----------|----------|--------|------|
| `--figma-api-key=<key>` | `FIGMA_API_KEY` | — | Figma Personal Access Token |
| `--figma-oauth-token=<token>` | `FIGMA_OAUTH_TOKEN` | — | Figma OAuth Bearer Token |
| `--port=<n>` | `PORT` / `FRAMELINK_PORT` | `3333` | HTTP 监听端口 |
| `--host=<host>` | `FRAMELINK_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `--json` | `OUTPUT_FORMAT=json` | YAML | 输出 JSON 格式 |
| `--skip-image-downloads` | `SKIP_IMAGE_DOWNLOADS=true` | 关闭 | 禁用图片下载工具 |
| `--image-dir=<path>` | `IMAGE_DIR` | 当前目录 | 图片保存根目录 |
| `--skills-dir=<path>` | `SKILLS_DIR` | — | 自定义技能目录 |
| `--design-density=<d>` | `FRAMELINK_DESIGN_DENSITY` | `auto` | `auto` / `mdpi` / `xhdpi` / `xxhdpi` |
| `--output-platform=<p>` | `OUTPUT_PLATFORM` | `compose` | `compose` / `views` |
| `--proxy=<url>` | `FIGMA_PROXY` | — | 代理地址；传 `none` 忽略系统代理 |
| `--env=<path>` | — | `.env` | 自定义 .env 文件路径 |
| `--stdio` | — | 关闭 | stdio 传输模式 |
| `--no-telemetry` | `FRAMELINK_TELEMETRY` / `DO_NOT_TRACK` | 关闭 | 禁用遥测 |

## 提交规范

### Commit Message

项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范，由 [release-please](https://github.com/googleapis/release-please) 自动管理版本：

- `fix: <描述>` — 修复 bug，触发 patch 版本
- `feat: <描述>` — 新功能，触发 minor 版本
- `feat!: <描述>` 或 `BREAKING CHANGE:` — 破坏性变更，触发 major 版本
- `chore:`、`docs:`、`test:`、`refactor:` — 不触发版本发布

### PR 流程

1. Fork 仓库，创建 feature 分支
2. 编写代码，遵循项目代码风格
3. 为新功能添加测试
4. 确保以下命令通过：
   ```bash
   pnpm test
   pnpm type-check
   pnpm lint
   ```
5. 提交 PR，描述中说明变更的**动机**和**影响**

> PR 标题使用 Conventional Commits 前缀，因为 PR 是 squash merge，PR 标题即为最终 commit message。

## 代码风格

- 所有新代码使用 TypeScript
- 使用 Prettier 格式化（`pnpm format`）
- 使用 ESLint 检查（`pnpm lint`）
- 遵循已有代码的命名和结构模式

### 路径别名

项目使用 `~/` 作为 `src/` 的别名（在 `tsconfig.json` 和 `vitest.config.ts` 中配置）。

### 注释规范

#### 不可接受的注释

- 复述代码做了什么
- 被注释掉的代码（直接删除）
- 显而易见的注释（"计数器 +1"）
- 用注释代替好的命名

#### 优秀的注释

- **为什么存在** — 解决什么问题，有什么价值
- **为什么这样写** — 重要的设计决策及其理由
- **为什么不用另一方案** — 你考虑过但拒绝的方案，避免后来者重新尝试失败的想法
- **警告** — 不明显的坑、顺序依赖、"这必须在 X 之前执行"
- **领域桥接** — 代码实现无法完全表达底层领域概念时（财务计算、协议规范、算法）
- **看起来不对** — 代码看似无用、冗余、错误但存在有非显而易见的理由（如接口契约、load-bearing 副作用）
- **留白意图** — 代码刻意不处理某个情况，且这种缺席是故意的（如"不重试——由调用方处理 backoff"可防止有人"好心"添加重试逻辑破坏上游假设）

## 测试哲学

写测试，但不要太多。以集成测试为主。

- 每个测试都有成本：维护开销、误报、更慢的 CI。测试必须物有所值。
- 多数功能需要 2-5 个测试，少数简单场景可以为零。
- **测行为，不测实现。** 测试应该验证代码做了什么，而非怎么做。只用公共接口上的方法验证行为。
- **不测类型系统已保证的东西。** TypeScript 编译时能检查的，不需要运行时再测。
- **不测框架。** 不用验证 Express 路由、React 渲染或 ORM 查询是否工作——测你自己的逻辑。
- **优先用真实实现而非 mock。** Mock 将测试耦合到实现细节。只在系统边界处（网络、文件系统、时间）做 mock。

### 应该测试的

- 会阻塞真实用户的失败场景
- 不直观且可能静默回归的行为
- 关键集成点和状态转换

### 不需要测试的

- 实现细节、私有方法、trivial 代码
- 实践中不会出现的边缘情况
- 测同一底层行为的不同变体

## 错误处理

信任内部代码和框架的保证。只在系统边界处做校验——用户输入、外部 API、文件 I/O。不要为不可能发生的场景添加 try/catch、fallback 或防御性检查。让错误自然传播，由知道如何处理它们的调用者去捕获。

## 质量

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

对于每个变更提议，审视现有系统，重新设计成最优美的方案——就像这个变更从一开始就是基础假设一样。你不只是在写代码，你在塑造这个项目的未来。你建立的模式会被复制，你偷的懒会被重复。

Fight entropy. Leave the codebase better than you found it.

## 欢迎的贡献

- **Android 平台增强** — 改进 Compose/Views 输出，新增 Android 框架支持
- **图片处理优化** — 更智能的图片裁剪、压缩、格式选择
- **布局推断改进** — 让 Android 布局属性推断更精准
- **技能/规则扩展** — 新增内置技能，覆盖更多设计→代码约束场景
- **Section 支持增强** — 更智能的多状态识别和分组
- **密度适配** — 改进设计密度自动检测，支持更多密度桶
- **Bug 修复** — 提升稳定性
- **性能优化** — 让服务更快
- **测试覆盖** — 为关键路径补充测试

## 不接受的贡献

- 超出"提取 Figma 设计数据供 AI 消费"范围的功能（图片编辑、CMS 同步、代码生成、第三方集成等）
- 未经讨论的破坏性变更
- 不遵循代码风格的提交
- 没有测试的新功能（核心逻辑）

## License

贡献代码即表示你同意将代码以 MIT License 发布。
