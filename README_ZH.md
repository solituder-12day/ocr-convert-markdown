# OCR convert Markdown — Obsidian 插件

将 PDF、Word、Excel、图片转换为 Markdown 笔记。支持直接提取文本，也支持在扫描件或图片内容中使用可配置 OCR 兜底。

## 快速开始

1. 安装并启用插件
2. 打开「设置 → OCR convert Markdown」
3. 如需 OCR，在插件设置中配置 OCR 模型
4. 点击左侧 Ribbon 图标或 `Ctrl+P` → **Import external file**

## 使用方式

| 方式 | 操作 |
|------|------|
| Ribbon 图标 | 点击 📂 → 从电脑选择文件 |
| 右键 vault 文件 | 文件管理器右键 →「转换为 Markdown」 |
| 命令面板 | `Ctrl+P` →「Convert to Markdown」或「Import external file」 |

## 功能

- **PDF 转换** — 文字型直接提取；扫描件自动 OCR（逐页流式处理）
- **Word 转换** — 保留标题、加粗、列表层级
- **Excel 转换** — 多工作表原样转 Markdown 表格；日期自动格式化
- **图片 OCR** — PNG / JPG / WEBP → OCR 识别
- **自定义 OCR 模型** — 在设置中配置兼容的 OCR 服务
- **自动切换** — 按配置顺序依次尝试，失败后自动换下一个模型

## 模型配置

支持添加一个或多个 OCR 模型，每个模型包含：

| 配置项 | 说明 |
|--------|------|
| 名称 | 显示名称 |
| 协议 | OCR 服务使用的请求格式 |
| 地址 | 服务端点 |
| 凭据 | 仅保存在本地 Obsidian 插件设置中 |
| 模型名 | 发送给服务的模型标识 |
| Max Tokens | 每次请求最大输出 Token 数 |
| 启用 | 是否加入 OCR 调用链 |

使用 ↑↓ 箭头调整顺序，模型按从上到下的顺序依次调用。

README 不列出具体服务端点或凭据。服务地址和密钥请只保存在本地 Obsidian 设置中。

## 安装

下载 `main.js`、`manifest.json`、`styles.css` 放入 `vault/.obsidian/plugins/ocr-convert-markdown/` 目录。

```bash
git clone git@github.com:solituder-12day/ocr-convert-markdown.git
cd ocr-convert-markdown
npm install
npm run build
```

## 技术栈

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## 作者

solituder-12day

## 许可

MIT
