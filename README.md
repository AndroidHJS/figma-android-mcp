# Figma Android MCP

将 Figma 设计数据转换为 Android 原生布局代码的 MCP 服务器。专为 Cursor 等 AI 编码工具设计，让其能直接获取 Figma 设计数据并生成 Jetpack Compose 或传统 View/XML 代码。

基于 [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)，针对 Android 平台做了深度优化。

## 为什么用它？

把 Figma 截图贴给 AI 容易产生偏差。将 Figma 设计数据直接喂给 AI 编码工具，设计还原更精准，一次生成更靠谱。

## 特性

- **双平台输出** — 支持 Jetpack Compose（默认）和传统 View/XML 两种输出模式
- **智能布局推断** — 自动从 Figma 节点坐标推断 `Column`/`Row` 布局
- **响应式尺寸** — 屏幕宽度/高度的节点自动转为 `fillMaxWidth()`/`fillMaxHeight()` 或 `match_parent`
- **Android 专属提示** — 输出附带 FrameLayout、ConstraintLayout 使用规则等 Android 布局最佳实践
- **图片下载** — 通过 `download_figma_images` 工具下载所需的图片资源
- **尺寸单位** — 布局使用 dp，字体使用 sp，颜色使用 hex/rgba

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

## 配置参数

| 参数 | 环境变量 | 说明 | 默认值 |
|------|---------|------|--------|
| `--figma-api-key` | `FIGMA_API_KEY` | Figma Personal Access Token | - |
| `--figma-oauth-token` | `FIGMA_OAUTH_TOKEN` | Figma OAuth Bearer Token | - |
| `--output-platform` | `OUTPUT_PLATFORM` | 输出平台：`compose` 或 `views` | `compose` |
| `--json` | `OUTPUT_FORMAT=json` | 输出 JSON 格式（默认 YAML） | - |
| `--port` | `PORT` | HTTP 服务端口 | `3333` |
| `--stdio` | - | stdio 传输模式（MCP 客户端使用） | - |
| `--skip-image-downloads` | `SKIP_IMAGE_DOWNLOADS=true` | 禁用图片下载工具 | `false` |
| `--no-telemetry` | `FRAMELINK_TELEMETRY=false` | 关闭遥测 | `false` |

## MCP 工具

### `get_figma_data`

获取 Figma 文件或节点的设计数据，返回精简后的布局信息。输出包含：
- `nodes` — 节点树，含布局和样式信息
- `globalVars` — 共享样式变量
- `imageAssets` — 需要下载的图片节点列表
- `screen` — 设计画布尺寸
- `layoutHints` — Android 布局最佳实践提示

### `download_figma_images`

根据 `get_figma_data` 返回的 `imageAssets` 列表，下载对应的 PNG 图片。

## 输出平台差异

### Compose (`--output-platform=compose`)

布局字段使用 Compose 术语：`arrangement`、`alignment`、`spacing`、`width`、`height`。自动推断 `Column`/`Row`，满屏节点转为 `fillMaxSize()` 等。

### Views (`--output-platform=views`)

布局字段使用 View/XML 术语：`orientation`、`gravity`、`layout_width`、`layout_height`。输出附带 Android View 系统的布局提示（FrameLayout 使用规则、ConstraintLayout 适用场景、elevation 替代方案等）。

## License

MIT
