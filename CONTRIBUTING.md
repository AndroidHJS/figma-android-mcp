# Contributing to Figma Android MCP

感谢你对 Figma Android MCP 项目的关注！这份指南将帮助你了解如何参与贡献。

## 项目定位

本项目是 [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) 的 Android 定制分支，专为 Android 开发者打造。核心改动包括：

- **Android 原生输出** — 通过 `--output-platform` 支持 Compose 和 Views/XML 两种布局术语输出
- **图片优化** — 集成 Jimp 对 Figma 图片进行裁剪、格式转换等处理
- **布局推断增强** — 更精准的 Android 布局属性推断

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
  "Figma Android MCP (Local)": {
    "url": "http://localhost:3333/mcp"
  }
}
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式（watch + 自动重启） |
| `pnpm build` | 生产构建 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm inspect` | MCP Inspector 调试 |

## 项目结构

```
src/
├── bin.ts                      # CLI 入口
├── config.ts                   # 配置管理（CLI 参数 + 环境变量）
├── server.ts                   # 服务器初始化（stdio / HTTP）
├── index.ts                    # 库导出
├── mcp-server.ts               # MCP 服务器工厂函数
├── commands/
│   └── fetch.ts                # 命令行 fetch 逻辑
├── mcp/
│   ├── index.ts                # MCP 工具注册入口
│   ├── tools/                  # MCP 工具定义与处理器
│   │   ├── get-figma-data-tool.ts
│   │   └── download-figma-images-tool.ts
│   ├── progress.ts             # 进度通知
│   └── validation-capture.ts   # 校验捕获
├── services/
│   ├── figma.ts                # Figma REST API 客户端
│   ├── get-figma-data.ts       # 获取 Figma 数据核心逻辑
│   ├── download-figma-images.ts
│   ├── get-figma-data-metrics.ts
│   └── errors/                 # 错误类型（限流、权限等）
├── extractors/
│   ├── design-extractor.ts     # 提取器入口
│   ├── node-walker.ts          # 递归节点遍历
│   ├── built-in.ts             # 内置提取器集合
│   ├── types.ts
│   └── index.ts
├── transformers/
│   ├── layout.ts               # 布局属性转换
│   ├── style.ts                # 样式转换（填充、描边）
│   ├── effects.ts              # 效果转换（阴影、模糊）
│   ├── text.ts                 # 文本内容与样式
│   └── component.ts            # 组件元数据
├── platform-mappers/           # Android 平台输出映射
│   ├── compose.ts              # Compose 术语（arrangement, alignment...）
│   ├── views.ts                # Views/XML 术语（gravity, layout_width...）
│   ├── types.ts
│   └── index.ts
├── telemetry/
│   ├── client.ts
│   ├── capture.ts
│   ├── types.ts
│   └── index.ts
├── utils/
│   ├── image-processing.ts     # Jimp 图片处理（裁剪、格式转换）
│   ├── dedup-images.ts         # 图片去重
│   ├── figma-url.ts            # Figma URL 解析
│   ├── fetch-json.ts
│   ├── identity.ts
│   ├── logger.ts
│   ├── serialize.ts
│   └── ...
└── tests/                      # 测试文件
```

## 核心设计

### 数据流

1. **MCP Tools** — 接收客户端请求，定义工具参数 Schema
2. **Figma Service** — 调用 Figma REST API，处理认证和请求
3. **Extractors** — 遍历节点树，提取布局、文本、样式、组件信息
4. **Transformers** — 将 Figma 原始属性转换为结构化数据
5. **Platform Mappers** — 将布局术语映射为 Android 原生表达（Compose / Views）

### 平台映射器

这是本项目的核心差异化功能。`platform-mappers/` 目录下包含两种 Android 输出模式：

- **compose**（默认）— Jetpack Compose 布局术语：`arrangement`、`alignment`、`spacing`、`width`、`height`
- **views** — 传统 XML/View 布局术语：`orientation`、`gravity`、`layout_width`、`layout_height`

新增平台支持时，只需在 `platform-mappers/` 下添加新的映射器并注册到 `index.ts`。

## 提交规范

### Commit Message

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `fix: <描述>` — 修复 bug，触发 patch 版本
- `feat: <描述>` — 新功能，触发 minor 版本
- `feat!: <描述>` 或包含 `BREAKING CHANGE:` — 破坏性变更，触发 major 版本
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

## 代码风格

- 所有新代码使用 TypeScript
- 使用 Prettier 格式化（`pnpm format`）
- 使用 ESLint 检查（`pnpm lint`）
- 遵循已有代码的命名和结构模式

### 路径别名

项目使用 `~/` 作为 `src/` 的别名（在 `tsconfig.json` 和 `vitest.config.ts` 中配置）。

## 测试哲学

写测试，但不要太多。以集成测试为主。

- 每个测试都有成本：维护开销、误报、更慢的 CI。测试必须物有所值。
- 多数功能需要 2-5 个测试，少数简单场景可以为零。
- **测行为，不测实现。** 测试应该验证代码做了什么，而非怎么做。
- **不测类型系统已保证的东西。** TypeScript 编译时能检查的，不需要运行时再测。
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

## 欢迎的贡献

- **Android 平台增强** — 改进 Compose/Views 输出，新增其他 Android 框架支持
- **图片处理优化** — 更智能的图片裁剪、压缩、格式选择
- **布局推断改进** — 让 Android 布局属性推断更精准
- **Bug 修复** — 提升稳定性
- **性能优化** — 让服务更快
- **测试覆盖** — 为关键路径补充测试

## 不接受的贡献

- 超出"提取 Figma 设计数据供 AI 消费"范围的功能（图片编辑、CMS 同步、代码生成等）
- 未经讨论的破坏性变更
- 不遵循代码风格的提交
- 没有测试的新功能（核心逻辑）

## License

贡献代码即表示你同意将代码以 MIT License 发布。
