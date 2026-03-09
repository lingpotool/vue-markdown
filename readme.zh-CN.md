# vue-markdown

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](license)

[react-markdown](https://github.com/remarkjs/react-markdown) (v10.1.0) 的 Vue 3 移植版 - 使用 [unified](https://github.com/unifiedjs/unified) / [remark](https://github.com/remarkjs/remark) / [rehype](https://github.com/rehypejs/rehype) 生态将 Markdown 渲染为 Vue 组件。

[English](readme.md) | 中文

> **AI 生成项目声明**: 本项目完全由 AI 生成 (Kiro AI IDE + Claude)。代码、测试和文档均通过 AI 辅助开发完成。虽然经过了充分测试 (58 个测试, 包括属性测试), 但请在生产环境使用前自行审查代码。

## 这是什么?

这个库是 `react-markdown` 到 Vue 3 的忠实 1:1 翻译。它使用相同的 unified 管道将 Markdown 文本转换为 Vue VNode, 因此你可以获得相同的功能、相同的插件生态和相同的行为 - 只是换成了 Vue。

### 翻译对照

| react-markdown | vue-markdown | 说明 |
|---|---|---|
| `react/jsx-runtime` | `vue/jsx-runtime` | Vue 3.3+ 内置 |
| `Markdown` (函数组件) | `VueMarkdown` (`defineComponent`) | 同步渲染 |
| `MarkdownAsync` (异步组件) | `VueMarkdownAsync` (`defineAsyncComponent`) | 配合 `<Suspense>` 使用 |
| `MarkdownHooks` (hooks 组件) | `VueMarkdownHooks` (`defineComponent`) | `ref` + `watchEffect` |
| `unreachable()` (`devlop` 包) | `throw new Error()` | 无额外依赖 |
| - | `elementAttributeNameCase: 'html'` | Vue JSX runtime 必需 |

## 安装

```bash
npm install git+https://github.com/lingpotool/vue-markdown.git
```

或使用 pnpm:

```bash
pnpm add git+https://github.com/lingpotool/vue-markdown.git
```

> **对等依赖**: Vue >= 3.3.0

## 使用

### 基础用法 (同步)

```vue
<script setup>
import VueMarkdown from 'vue-markdown'
</script>

<template>
  <VueMarkdown children="# 你好, *世界*!" />
</template>
```

### 使用插件

```vue
<script setup>
import VueMarkdown from 'vue-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]
</script>

<template>
  <VueMarkdown
    children="| 功能 | 状态 |\n|---|---|\n| 表格 | OK |"
    :remarkPlugins="plugins"
  />
</template>
```

### 异步 (配合 `<Suspense>`)

```vue
<script setup>
import { VueMarkdownAsync } from 'vue-markdown'
import { markRaw } from 'vue'

const AsyncMd = markRaw(VueMarkdownAsync({
  children: '# 异步内容',
  remarkPlugins: [/* 异步插件 */]
}))
</script>

<template>
  <Suspense>
    <component :is="AsyncMd" />
    <template #fallback>加载中...</template>
  </Suspense>
</template>
```

### Hooks (响应式异步)

```vue
<script setup>
import { VueMarkdownHooks } from 'vue-markdown'
import { ref } from 'vue'

const md = ref('# 你好')
</script>

<template>
  <VueMarkdownHooks :children="md">
    <template #fallback>加载中...</template>
  </VueMarkdownHooks>
</template>
```

## API

### `VueMarkdown` (默认导出)

同步组件。Props:

| Prop | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `children` | `string` | `''` | Markdown 内容 |
| `remarkPlugins` | `Array` | `null` | remark 插件列表 |
| `rehypePlugins` | `Array` | `null` | rehype 插件列表 |
| `remarkRehypeOptions` | `Object` | `null` | remark-rehype 选项 |
| `components` | `Object` | `null` | 标签名到 Vue 组件的映射 |
| `allowedElements` | `string[]` | `null` | 只允许这些元素 |
| `disallowedElements` | `string[]` | `null` | 禁止这些元素 |
| `allowElement` | `Function` | `null` | 元素过滤函数 |
| `unwrapDisallowed` | `boolean` | `false` | 展开被禁止的元素 (保留子节点) |
| `skipHtml` | `boolean` | `false` | 跳过 Markdown 中的 HTML |
| `urlTransform` | `Function \| null` | `defaultUrlTransform` | URL 转换函数; 传 `null` 跳过处理 |

### `VueMarkdownAsync(options)`

工厂函数, 返回异步组件。选项与 `VueMarkdown` 相同。需配合 `<Suspense>` 使用。

### `VueMarkdownHooks`

响应式异步组件。Props 与 `VueMarkdown` 相同, 额外支持:

| Prop | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `fallback` | `VNode` | `null` | 加载时显示的内容 |

也支持 `#fallback` 插槽。

### `defaultUrlTransform(url)`

默认 URL 安全过滤器。允许 `http`、`https`、`irc`、`ircs`、`mailto`、`xmpp` 协议和相对 URL。对不安全协议返回空字符串。

## 自定义组件

```vue
<script setup>
import VueMarkdown from 'vue-markdown'
import { h } from 'vue'

const components = {
  h1: (props) => h('h1', { class: 'title', ...props }, props.children),
  a: (props) => h('a', { target: '_blank', ...props }, props.children)
}
</script>

<template>
  <VueMarkdown children="# 点击 [这里](https://example.com)" :components="components" />
</template>
```

自定义组件会收到一个 `node` prop, 包含 HAST 元素节点。

## 与 react-markdown 的兼容性

这是 react-markdown v10.1.0 的逐行翻译。所有纯逻辑函数 (`createProcessor`、`createFile`、`defaultUrlTransform`、`post`) 完全一致。唯一的差异是 Vue 特有的适配:

- `toJsxRuntime` 调用中添加 `elementAttributeNameCase: 'html'` (Vue JSX runtime 必需)
- Vue 组件模型 (`defineComponent`、`defineAsyncComponent`) 替代 React 函数组件
- Vue Composition API (`ref`、`computed`、`watchEffect`) 替代 React hooks
- `urlTransform: null` 完全跳过 URL 处理 (react-markdown 会回退到默认值)

## 测试

```bash
npm test
```

共 58 个测试:
- 26 个属性测试 (fast-check), 覆盖 15 个正确性属性
- 32 个单元测试, 覆盖边界情况和集成测试

## 许可证

[MIT](license)

## 致谢

- [react-markdown](https://github.com/remarkjs/react-markdown) - 本项目移植的原始项目
- [unified](https://github.com/unifiedjs/unified) 生态 - Markdown/HTML 处理管道
- [Kiro AI IDE](https://kiro.dev) - 用于生成本项目的 AI 辅助开发环境
