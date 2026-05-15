# OCR convert Markdown

一键将 PDF、Word、Excel、图片转换为 Markdown 笔记。支持文字直接提取和 AI OCR（GLM-4V / MiniMax / Gemini 多模型）。

## 快速开始

1. 安装并启用插件
2. 打开「设置 → OCR convert Markdown」，填入至少一个 API Key
3. **右键** vault 中的 .pdf / .docx / .xlsx / .png / .jpg 文件 →「转换为 Markdown」
4. 自动在原文件同目录生成 `.md` 文件

## 使用方式

| 方式 | 操作 |
|------|------|
| 右键文件 | 文件管理器右键目标文件 →「转换为 Markdown」 |
| 命令面板 | `Ctrl+P` →「Convert to Markdown」（对当前打开的文件生效） |
| 工具栏按钮 | 点击左侧 ribbon 图标（对当前打开的文件生效） |

## 功能

| 功能 | 说明 |
|------|------|
| **PDF 转换** | 文字型 PDF → 直接提取文字；扫描件 → 自动渲染为图片后 OCR |
| **Word 转换** | 保留标题层级、加粗、列表缩进 |
| **Excel 转换** | 多工作表逐一读取，原样转为 Markdown 表格 |
| **图片 OCR** | 支持 PNG / JPG / WEBP，调用 AI 模型识别为 Markdown |
| **多模型 OCR** | 可选 GLM-4V / MiniMax / Gemini，支持自动切换 |
| **中英文界面** | 设置页一键切换语言 |

## 配置

进入 Obsidian 设置 → **OCR convert Markdown** 配置页：

| 配置项 | 说明 | 获取地址 |
|--------|------|---------|
| **界面语言** | 中文 / English | — |
| **OCR 模型** | 自动 / GLM-4V / GLM-4V-Flash / MiniMax / Gemini | — |
| **GLM API Key** | 智谱 AI，文字识别精度高，首选 | [open.bigmodel.cn](https://open.bigmodel.cn) |
| **MiniMax API Key** | 备选模型 | [platform.minimax.com](https://platform.minimax.com) |
| **Gemini API Key** | 备选模型 | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

至少填写一个 API Key 即可使用。填写多个 Key 时，「自动」模式会按 GLM → MiniMax → Gemini 依次尝试。

## 处理流程

```
输入文件
  ├── PDF ──── 文字型 → pdfjs 直接提取
  │            扫描件 → 逐页渲染图片 → OCR
  ├── Word ──── mammoth → HTML → Markdown
  ├── Excel ─── SheetJS → 多工作表 → Markdown 表格
  └── 图片 ─── Base64 → GLM-4V / MiniMax / Gemini
                              ↓
                    输出 .md 文件到 vault
```

## 安装

### 手动安装

下载 `main.js`、`manifest.json`、`styles.css` 三个文件，放入 vault 目录下的 `.obsidian/plugins/ocr-convert-markdown/` 文件夹中，然后在 Obsidian 设置中启用插件。

### 从源码构建

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

将生成的 `main.js`、`manifest.json`、`styles.css` 复制到 vault 的插件目录。

## 开发

```bash
npm run dev       # 监听模式，增量编译
npm run build     # 生产构建，输出 main.js
```

项目结构：

```
├── main.ts          # 入口：命令、设置页、OCR 引擎
├── manifest.json    # 插件元数据
├── styles.css       # 自定义样式
├── package.json     # 依赖
├── tsconfig.json    # TypeScript 配置
└── esbuild.config.mjs # 构建配置
```

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | [Obsidian API](https://docs.obsidian.md) |
| 构建 | TypeScript + esbuild |
| PDF 解析 | [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) |
| Word 解析 | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| Excel 解析 | [SheetJS](https://sheetjs.com) |
| OCR 模型 | GLM-4V（智谱）/ MiniMax / Gemini 2.5 Flash |

## 许可

MIT
