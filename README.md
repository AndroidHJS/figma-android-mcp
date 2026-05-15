# Figma Android MCP

将 Figma 设计数据转换为 Android 原生布局代码的 MCP 服务器。专为 Cursor、Claude Code 等 AI 编码工具设计，让其能直接获取 Figma 设计数据并生成 Jetpack Compose 或传统 View/XML 代码。

基于 [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)，针对 Android 平台做了深度优化。

## 为什么用它？

把 Figma 截图贴给 AI 容易产生偏差。将 Figma 设计数据直接喂给 AI 编码工具，设计还原更精准，一次生成更靠谱。

## 特性

- **双平台输出** — 支持 Jetpack Compose（默认）和传统 View/XML 两种输出模式
- **智能布局推断** — 自动从 Figma 节点坐标推断 `Column`/`Row` 布局，识别 Stack 叠加区域
- **响应式尺寸** — 屏幕宽度/高度的节点自动转为 `fillMaxWidth()`/`fillMaxHeight()` 或 `match_parent`
- **布局提示 & 规则** — 输出附带 FrameLayout、ConstraintLayout 使用规则等 Android 布局最佳实践
- **区域分组建议** — 自动检测视觉分隔线，输出 region hints 帮助 AI 划分独立 UI 区域
- **设计稿预览** — 可选 2x PNG 截图，AI 可对照截图做视觉校验，提升像素级还原度
- **MCP Skill 系统** — 内置 `android-layout` 翻译规则和 `figma-android-mcp-skill` 完整还原流程，AI 客户端可通过 `get_skill` 工具或 Skill 资源获取
- **图片资源管理** — 支持设计师 Export 标记过滤下载、多密度（xhdpi/xxhdpi）导出、本地路径校验
- **尺寸单位** — 布局输出 dp，字体输出 sp，颜色输出 hex/rgba
- **HTTP + stdio 双传输** — 同时支持 StreamableHTTP 和 stdio 模式，适配不同 MCP 客户端

## 快速开始

需要先创建 Figma API Token：[创建教程](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)

### MacOS / Linux

**Compose 项目：**

```json
{
  "mcpServers": {
    "Figma Android MCP": {
      "command": "npx",
      "args": ["-y", "figma-android-mcp", "--figma-api-key=你的KEY", "--output-platform=compose", "--stdio"]
    }
  }
}
```

**View/XML 项目：**

```json
{
  "mcpServers": {
    "Figma Android MCP": {
      "command": "npx",
      "args": ["-y", "figma-android-mcp", "--figma-api-key=你的KEY", "--output-platform=views", "--stdio"]
    }
  }
}
```

### Windows

**Compose 项目：**

```json
{
  "mcpServers": {
    "Figma Android MCP": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "figma-android-mcp", "--figma-api-key=你的KEY", "--output-platform=compose", "--stdio"]
    }
  }
}
```

**View/XML 项目：**

```json
{
  "mcpServers": {
    "Figma Android MCP": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "figma-android-mcp", "--figma-api-key=你的KEY", "--output-platform=views", "--stdio"]
    }
  }
}
```

也可以通过 `FIGMA_API_KEY`、`OUTPUT_PLATFORM` 等环境变量配置，放在 `.env` 文件中或 MCP 的 `env` 字段里。

### 鉴权方式

支持两种鉴权方式，优先级：OAuth Token > Personal Access Token > 无全局凭证（HTTP 模式下通过请求头传入）。

| 方式 | 参数 | 环境变量 |
|------|------|---------|
| Personal Access Token | `--figma-api-key` | `FIGMA_API_KEY` |
| OAuth Bearer Token | `--figma-oauth-token` | `FIGMA_OAUTH_TOKEN` |

HTTP 模式下可以不设全局凭证，客户端通过 `X-Figma-Token` 请求头按请求传入 token。

## 配置参数

| 参数 | 环境变量 | 说明 | 默认值 |
|------|---------|------|--------|
| `--figma-api-key` | `FIGMA_API_KEY` | Figma Personal Access Token | - |
| `--figma-oauth-token` | `FIGMA_OAUTH_TOKEN` | Figma OAuth Bearer Token | - |
| `--output-platform` | `OUTPUT_PLATFORM` | 输出平台：`compose` 或 `views` | `compose` |
| `--json` | `OUTPUT_FORMAT=json` | 输出 JSON 格式（默认 YAML） | - |
| `--port` | `PORT` / `FRAMELINK_PORT` | HTTP 服务端口 | `3333` |
| `--host` | `FRAMELINK_HOST` | HTTP 服务绑定地址 | `127.0.0.1` |
| `--stdio` | - | stdio 传输模式（MCP 客户端使用） | - |
| `--skip-image-downloads` | `SKIP_IMAGE_DOWNLOADS=true` | 禁用图片下载工具 | `false` |
| `--image-dir` | `IMAGE_DIR` | 图片下载输出目录 | 当前工作目录 |
| `--skills-dir` | `SKILLS_DIR` | 自定义技能文件目录（补充内置技能） | - |
| `--design-density` | `FRAMELINK_DESIGN_DENSITY` | 设计稿基准密度：`auto` / `mdpi` / `xhdpi` / `xxhdpi` | `auto` |
| `--proxy` | `FIGMA_PROXY` | Figma API 代理地址 | - |
| `--no-telemetry` | `FRAMELINK_TELEMETRY=false` | 关闭遥测 | `false` |

## MCP 工具

### `get_figma_data`

获取 Figma 文件或节点的设计数据，返回精简后的布局信息。

**参数：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `fileKey` | string | 是 | Figma 文件 Key |
| `nodeId` | string | 否 | 节点 ID（如 `1234-5678`），不传则返回整页 |
| `depth` | number | 否 | 遍历节点树的深度，不传则全部遍历 |
| `includePreview` | boolean | 否 | 是否返回 2x PNG 设计稿截图，默认 `false` |
| `outputPlatform` | enum | 否 | 输出平台风格：`compose` 或 `views`。不传则继承服务器级 `--output-platform` 设置 |

**输出包含：**
- `nodes` — 节点树，含布局和样式信息（尺寸已是 dp，字号已是 sp）
- `globalVars` — 共享样式变量
- `imageAssets` — 需要下载的图片节点列表（含 `category` 和 `suggestedFileName`）
- `screen` — 设计画布尺寸
- `layoutHints` — Android 布局最佳实践提示（容器选择、绝对定位、图片缩放、字体粗细等）
- `regionHints` — 视觉区域分组建议
- `_REQUIRED_RULES` — 关联的 Skill 引用

### `download_figma_images`

根据 `get_figma_data` 返回的 `imageAssets` 列表，下载对应的 PNG 图片到 Android 项目的 `res` 目录。

**参数：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `fileKey` | string | 是 | Figma 文件 Key |
| `nodes` | array | 是 | 图片节点列表（含 `nodeId`、`fileName`、`category` 等） |
| `localPath` | string | 是 | Android 项目 res 目录相对路径（如 `app/src/main/res`） |
| `densities` | array | 否 | 下载的密度列表，支持 `mdpi`/`hdpi`/`xhdpi`/`xxhdpi`/`xxxhdpi`；默认 `["xhdpi", "xxhdpi"]` |
| `onlyExportTagged` | boolean | 否 | 仅下载设计师 Export 标记的节点，默认 `false` |

### `get_skill`

获取内置 Skill 的完整内容。AI 客户端调用此工具获取布局翻译规则和还原流程。

**参数：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Skill 名称：`android-layout` 或 `figma-android-mcp-skill` |

## MCP 资源

服务器暴露 Skill 资源，客户端可通过 `skill://` URI 协议读取：

- `skill://android-layout` — Android 布局翻译强制规则（响应式宽度、容器选择、通用反模式）
- `skill://figma-android-mcp-skill` — Figma → Android 完整还原工作流

## 输出平台差异

### Compose (`--output-platform=compose`)

布局字段使用 Compose 术语：`arrangement`、`alignment`、`spacing`、`width`、`height`。自动推断 `Column`/`Row`，满屏节点转为 `fillMaxSize()` 等。输出附带 Compose 专属规则提示（`ContentScale.FillBounds`、`FontWeight.Bold`、`Brush` gradient 等）。

### Views (`--output-platform=views`)

布局字段使用 View/XML 术语：`orientation`、`gravity`、`layout_width`、`layout_height`。输出附带 Android View 系统的布局提示（FrameLayout 使用规则、ConstraintLayout 适用场景、elevation 替代方案等）。

## 架构概览

```
src/
├── bin.ts                  # CLI 入口
├── server.ts               # 服务器初始化（stdio / HTTP 模式选择）
├── config.ts               # 配置解析（CLI 参数 + 环境变量）
├── mcp-server.ts           # 库级重导出
├── mcp/
│   ├── index.ts            # MCP Server 创建 & 工具注册
│   ├── tools/              # 工具定义（get_figma_data、download_figma_images、get_skill）
│   └── resources/          # MCP 资源（Skill）
├── extractors/             # Figma 节点提取器（布局、文本、视觉、组件）
├── transformers/           # 属性转换器（布局、样式、效果、文本、组件、区域提示）
├── platform-mappers/       # 平台映射（compose / views 术语转换）
├── services/
│   ├── figma.ts            # Figma REST API 客户端
│   ├── get-figma-data.ts   # 数据获取 & 简化主流程
│   └── download-figma-images.ts  # 图片下载 & 多密度处理
├── skills/                 # MCP Skill 系统（内置 + 自定义加载）
└── utils/                  # 工具函数（序列化、单位转换、图片处理等）
```

## 本地开发

```bash
pnpm install          # 安装依赖
pnpm build            # 构建（tsup）
pnpm dev              # 开发模式（watch + HTTP）
pnpm dev:cli          # 开发模式（stdio）
pnpm test             # 运行测试（vitest）
pnpm type-check       # TypeScript 类型检查
pnpm lint             # ESLint
pnpm format           # Prettier 格式化
pnpm inspect          # MCP Inspector 调试
```

## License

MIT
