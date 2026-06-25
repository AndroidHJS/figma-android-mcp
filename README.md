# figma-android-mcp

## 简介

**figma-android-mcp** 是一个面向 Android 开发的 MCP 服务，为 Claude Code、Cursor 等 AI 编码工具提供 Figma 设计数据接入能力，支持自动生成 Jetpack Compose 与传统 View/XML 代码。

只需提供 Figma 链接，AI 工具即可完成设计数据读取、图片资源下载与代码生成的全流程。

- ⚡ **高效** — 秒级获取设计数据，无需手动导出或格式转换
- 🎯 **精准** — 自动适配 dp/sp 单位换算、多密度图片下载，支持 Compose / View 双输出
- 🔌 **易集成** — 单行配置即可接入，兼容 Claude Code / Cursor / VS Code 等主流工具

## 效果展示

> 🎬 Demo GIF（Coming Soon）
> 输入 Figma 链接 → Claude Code 自动生成 → 模拟器运行效果

## 快速上手

> 以下以 Claude Code 为例。其他客户端（Cursor、VS Code）的配置方式见 [AI 客户端配置](#ai-客户端配置)。

> 前置要求：Node.js >= 20.20.0

### 第一步：获取 Figma Token

1. 打开 Figma → 右上角头像 → **Settings**
2. 左侧选择 **Security** → **Personal access tokens**
3. 点击 **Generate new token** → 复制保存

### 第二步：配置 MCP

在项目根目录创建 `.claude/mcp.json`：

```json
{
  "mcpServers": {
    "figma-android-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "figma-android-mcp",
        "--figma-api-key=your-token-here",
        "--output-platform=compose",
        "--stdio"
      ]
    }
  }
}
```

> 将 `your-token-here` 替换为第一步获取的 Token。
> 如需生成传统 View/XML 代码，将 `--output-platform=compose` 改为 `--output-platform=views`。

### 第三步：验证安装

启动 Claude Code，输入：

```
/mcp
```

看到以下 3 个工具即表示配置成功：

- `get_figma_node`
- `get_skill`
- `download_figma_images`

### 第四步：开始使用

在 Claude Code 中直接粘贴 Figma 链接：

```
帮我把这个设计稿还原成 Compose 代码：
https://www.figma.com/design/xxxxxx/...
```

Claude Code 将自动读取设计数据、下载图片资源并生成代码。

## 配置说明

支持三层优先级：**CLI 参数 > 环境变量 > 默认值**。

> `.env` 文件会被自动加载，可通过 `--env=<path>` 指定路径。

### 认证（必填其一）

| CLI 参数 | 环境变量 | 说明 |
| --- | --- | --- |
| `--figma-api-key=<key>` | `FIGMA_API_KEY` | Figma Personal Access Token，适合个人开发、本地使用 |
| `--figma-oauth-token=<token>` | `FIGMA_OAUTH_TOKEN` | Figma OAuth Bearer Token，适合服务端、团队部署 |

### 服务器选项

| CLI 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--port=<n>` | `FRAMELINK_PORT` / `PORT` | `3333` | HTTP 模式监听端口，`FRAMELINK_PORT` 优先于 `PORT` |
| `--host=<host>` | `FRAMELINK_HOST` | `127.0.0.1` | HTTP 模式监听地址 |
| `--stdio` | — | 关闭 | 启用 stdio 传输模式（推荐，MCP 客户端直接集成时使用） |
| `--output-platform=<p>` | `OUTPUT_PLATFORM` | `compose` | 输出平台：`compose`（Jetpack Compose）/ `views`（传统 View/XML） |
| `--design-density=<d>` | `FRAMELINK_DESIGN_DENSITY` | `auto` | 设计稿密度：`auto` / `mdpi` / `xhdpi` / `xxhdpi` |
| `--image-dir=<path>` | `IMAGE_DIR` | 当前工作目录 | 图片资源保存根目录 |
| `--skills-dir=<path>` | `SKILLS_DIR` | — | 技能文件目录，见[技能系统](#技能系统) |
| `--env=<path>` | — | — | 指定 `.env` 文件路径，默认自动加载项目根目录 `.env` |
| `--skip-image-downloads` | `SKIP_IMAGE_DOWNLOADS=true` | 关闭 | 禁用图片下载 |
| `--json` | `OUTPUT_FORMAT=json` | YAML | 输出格式切换为 JSON |
| `--proxy=<url>` | `FIGMA_PROXY` | — | Figma API 代理地址 |
| `--no-telemetry` | `FRAMELINK_TELEMETRY=off` / `DO_NOT_TRACK` | 关闭 | 禁用遥测数据上报 |

### `--output-platform` 说明

该参数控制 MCP 返回给 AI 的布局字段风格，决定 AI 生成 Compose 还是 View/XML 代码：

| 值 | 布局字段风格 | AI 生成代码类型 |
| --- | --- | --- |
| `compose`（默认） | `layout` / `arrangement` / `alignment` / `spacing` | Jetpack Compose |
| `views` | `orientation` / `gravity` / `layout_width` / `layout_height` | 传统 Android View / XML |

> 也可在对话中通过 `outputPlatform` 参数动态覆盖服务端默认设置。

### AI 客户端配置

#### Claude Code

```json
{
  "mcpServers": {
    "figma-android-mcp": {
      "command": "npx",
      "args": ["-y", "figma-android-mcp", "--figma-api-key=your-key", "--output-platform=compose", "--stdio"]
    }
  }
}
```

#### Cursor

编辑 `~/.cursor/mcp.json` 或通过 `Cursor Settings` → `MCP` → `Add new MCP server` 添加：

```json
{
  "mcpServers": {
    "figma-android-mcp": {
      "command": "npx",
      "args": ["-y", "figma-android-mcp", "--figma-api-key=your-key", "--output-platform=compose", "--stdio"]
    }
  }
}
```

#### VS Code

编辑 `.vscode/mcp.json`（项目级）或 `%APPDATA%/Code/User/mcp.json`（全局）：

```json
{
  "servers": {
    "figma-android-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "figma-android-mcp", "--figma-api-key=your-key", "--output-platform=compose", "--stdio"]
    }
  }
}
```

> VS Code 配置字段名为 `servers`（非 `mcpServers`），且需要 `"type": "stdio"` 字段。

## MCP 工具

配置成功后，AI 客户端可调用以下 3 个工具。`get_figma_node` 是设计数据获取的唯一入口，无需区分节点类型。

### `get_figma_node`

获取 Figma 文件或指定节点的完整设计数据，包括布局、文本、样式、组件信息。同时支持 SECTION 节点的多状态/多页面分组。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileKey` | string | 是 | Figma 文件 Key，从 URL 中提取 |
| `nodeId` | string | 是 | 节点 ID，格式如 `1234:5678` |
| `depth` | number | 否 | 遍历深度，通常无需传入 |
| `includePreview` | boolean | 否 | 是否附带节点渲染截图（PNG @2x） |
| `manifestOnly` | boolean | 否 | 仅返回 SECTION 帧清单（含建议文件名），不需要子节点数据时设为 `true` |
| `outputPlatform` | enum | 否 | `compose` / `views`，覆盖服务端默认设置 |

- **FRAME / COMPONENT 节点** → 返回完整设计数据（布局、文本、样式、组件信息）
- **SECTION 节点** → 按帧分组，返回多状态/多页面数据。>5 帧时自动返回清单模式（仅帧元数据），可按帧逐一获取详情
- 返回数据包含 `imageAssets` 字段（需下载的图片列表），**生成代码前务必先调用 `download_figma_images` 下载图片资源**。

---

### `download_figma_images`

将设计稿中的图片资源按 Android 多密度规范下载到本地 `res/` 目录。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `fileKey` | string | — | Figma 文件 Key |
| `nodes` | array | — | 节点数组，每项含 `nodeId`、`fileName`、`category` |
| `localPath` | string | — | 保存路径，如 `app/src/main/res` |
| `densities` | array | `["xhdpi","xxhdpi"]` | 密度桶列表，如 `["mdpi","xhdpi","xxhdpi"]` |
| `onlyExportTagged` | boolean | `true` | 仅下载设计师标记了导出设置的节点；设为 `false` 可同时下载自动检测的图片 |

---

### `get_skill`

查询当前可用的技能列表，或获取指定技能的完整内容。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 技能名称；不传则列出所有可用技能 |

> 技能机制说明见[技能系统](#技能系统)。

## 技能系统

技能系统允许你通过 Markdown 文档约束 AI 生成代码的质量和规范，适合团队统一代码风格、强制执行项目规范。

### 内置技能

服务默认附带两个内置技能，**无需额外配置**即可生效：

| 技能名 | 说明 |
| --- | --- |
| `android-layout` | **Android 布局规则（强制）** — 宽度响应式、纯色占位、列表识别（RecyclerView + Adapter）、strings.xml 首尾空格、常见反模式检测等强制约束。AI 生成 Android 布局代码前必须遵守。 |
| `figma-android-mcp-skill` | **Figma → Android 还原流程** — 从 Figma URL 到代码的完整工作流：解析输入 → 截图对比 → 获取设计数据 → 资源分组 → 下载资源 → 生成代码。AI 检测到设计还原意图时自动触发。 |

AI 可在生成代码前调用 `get_skill("android-layout")` 加载布局约束，或调用 `get_skill("figma-android-mcp-skill")` 启动还原流程。

### 自定义技能

如需扩展团队规范，可在 `.claude/skills/` 目录下创建 Markdown 文件。**自定义技能与内置技能同名时，自定义优先**，可用于覆盖内置规则的特定部分。

### 工作原理

1. 在 `.claude/skills/` 目录下创建 Markdown 文件，描述代码规范或约束规则
2. AI 调用 `get_figma_node` 时，返回数据中会包含 `_REQUIRED_RULES` 字段（`workflow` 类技能不在此列，需手动调用 `get_skill()`）
3. `_REQUIRED_RULES` 引用相关技能文件，**AI 在生成代码前必须读取并遵守这些约束**

### 目录结构示例

```
.claude/
└── skills/
    ├── compose-style.md      # Compose 代码风格规范
    ├── naming-convention.md  # 命名规范
    └── component-rules.md    # 组件封装规则
```

> 以上为自定义扩展，内置技能已随服务提供，无需重复创建。

### 技能文件示例

技能文件必须以 YAML frontmatter 开头，声明 `name`、`title` 和 `description`：

```markdown
---
name: compose-style
title: Compose 代码风格规范
description: 约束 Compose 代码的命名、状态管理和组件抽取规则
---

# Compose 代码风格规范

## 组件命名
- 所有 Composable 函数以大驼峰命名
- Screen 级别组件以 Screen 结尾，如 `OrderStatusScreen`
- 共用组件放入 `ui/components/` 目录

## 状态管理
- 多状态页面使用 sealed class 管理状态
- 不允许在 Composable 内直接使用 ViewModel

## 重复组件
- 同一组件出现 3 次以上必须抽取为独立 Composable
- 组件参数必须支持自定义 Modifier
```

### 配置技能目录

在 MCP 配置中指定技能目录路径：

```json
{
  "mcpServers": {
    "figma-android-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "figma-android-mcp",
        "--figma-api-key=your-key",
        "--skills-dir=.claude/skills",
        "--stdio"
      ]
    }
  }
}
```

> 也可通过环境变量 `SKILLS_DIR` 指定路径。

## 常见问题

### Q1：输入 `/mcp` 后看不到 3 个工具？

检查以下几点：

1. `.claude/mcp.json` 路径是否正确（应在项目根目录）
2. Figma Token 是否有效，可在 Figma 设置中重新生成
3. Node.js 版本是否 >= 20.20.0，运行 `node -v` 确认
4. 重启 Claude Code 后再试

---

### Q2：遇到 Figma API 限流（Retry after ~xxxxxx seconds）？

这是 Figma API 的速率限制问题。常见原因是当前使用的 Token 属于 **Viewer / Collaborator** 级别的 Figma Seat，API 配额较低。

**解决方法：**

使用 **Dev / Full Seat** 账号重新生成 Token。Viewer / Collaborator Seat 的 API 配额极低（Tier 1 每月仅 6 次），Dev / Full Seat 可大幅提升限额。

教育版账号只要 Seat 类型为 Dev 或 Full，同样适用。

> 如何确认 Seat 类型：打开 Figma Account Settings → Admin Console → Members 查看。

---

### Q3：生成的代码图片资源缺失？

确认以下几点：

1. 设计师是否在 Figma 中为图片节点标记了导出设置
2. `--image-dir` 配置的路径是否正确
3. 如需下载未标记的图片，在提示词中说明，或将 `onlyExportTagged` 设为 `false`

---

### Q4：生成的是 View/XML 代码而不是 Compose？

检查 `--output-platform` 参数是否设置为 `compose`：

```json
"args": ["-y", "figma-android-mcp", "--figma-api-key=your-key", "--output-platform=compose", "--stdio"]
```

---

### Q5：多个状态画布被生成成多个独立页面？

在提示词中明确说明：

```
把这个 Section 转成 Compose 页面，用 sealed class 管理状态，不要生成多个独立页面：<URL>
```

`get_figma_node` 会自动识别 SECTION 节点并按状态分组返回，无需使用其他工具。

## License

MIT License © 2026