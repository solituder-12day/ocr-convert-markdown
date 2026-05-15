# OCR convert Markdown

一键将 PDF、Word、Excel、图片转换为 Markdown 笔记。支持文字直接提取和 AI OCR，模型可自由配置。

## 快速开始

1. 安装并启用插件
2. 打开「设置 → OCR convert Markdown」
3. 填入 API Key，确保至少一个模型处于启用状态
4. **右键** vault 中的文件 →「转换为 Markdown」

## 使用方式

| 方式 | 操作 |
|------|------|
| 右键文件 | 文件管理器右键 →「转换为 Markdown」 |
| 命令面板 | `Ctrl+P` →「Convert to Markdown」 |
| 工具栏按钮 | 点击左侧 ribbon 图标 |

## 功能

| 功能 | 说明 |
|------|------|
| **PDF 转换** | 文字型 → 直接提取；扫描件 → 自动渲染为图片后 OCR |
| **Word 转换** | 保留标题、加粗、列表层级 |
| **Excel 转换** | 多工作表原样转为 Markdown 表格 |
| **图片 OCR** | PNG / JPG / WEBP → OCR 识别 |
| **自定义模型** | 可自由添加任意支持 OCR 的 API（OpenAI 兼容 / Gemini） |
| **自动切换** | 按配置顺序依次尝试，失败后自动换下一个模型 |

## 模型配置

支持添加任意数量的 OCR 模型，每个模型包含：

| 配置项 | 说明 |
|--------|------|
| **名称** | 显示名称 |
| **API 协议** | `OpenAI 兼容` 或 `Gemini` |
| **API 地址** | 接口 URL |
| **API Key** | 认证密钥 |
| **模型名** | 发送给 API 的模型标识 |
| **启用** | 是否加入 OCR 调用链 |

使用 ↑↓ 箭头调整顺序，模型按从上到下的顺序依次调用。

**预置模型：**

| 模型 | 协议 | API 地址 |
|------|------|---------|
| GLM-4V（高精度） | OpenAI | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| GLM-4V-Flash（快速） | OpenAI | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| MiniMax | OpenAI | `https://api.minimax.chat/v1/chat/completions` |
| Gemini 2.5 Flash | Gemini | `.../models/gemini-2.5-flash:generateContent` |

你可以删除预置模型，也可以点击「添加模型」加入其他服务商（如 DeepSeek、通义千问等支持图片输入的模型）。

## 安装

下载 `main.js`、`manifest.json`、`styles.css` 放入 `vault/.obsidian/plugins/ocr-convert-markdown/` 目录。

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

## 开发

```bash
npm run dev       # 监听模式
npm run build     # 生产构建
```

## 技术栈

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## 许可

MIT
