// Vue imports (replacing React equivalents)
import {Fragment, jsx, jsxs} from 'vue/jsx-runtime'
import {defineComponent, defineAsyncComponent, computed, ref, watchEffect, shallowRef} from 'vue'

// Shared imports (identical to react-markdown)
import {toJsxRuntime} from 'hast-util-to-jsx-runtime'
import {urlAttributes} from 'html-url-attributes'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {unified} from 'unified'
import {visit} from 'unist-util-visit'
import {VFile} from 'vfile'

// --- Constants (translated from react-markdown) ---

const changelog =
  'https://github.com/remarkjs/react-markdown/blob/main/changelog.md'

const emptyPlugins = []
const emptyRemarkRehypeOptions = {allowDangerousHtml: true}
const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i

const deprecations = [
  {from: 'astPlugins', id: 'remove-buggy-html-in-markdown-parser'},
  {from: 'allowDangerousHtml', id: 'remove-buggy-html-in-markdown-parser'},
  {from: 'allowNode', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'allowElement'},
  {from: 'allowedTypes', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'allowedElements'},
  {from: 'className', id: 'remove-classname'},
  {from: 'disallowedTypes', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'disallowedElements'},
  {from: 'escapeHtml', id: 'remove-buggy-html-in-markdown-parser'},
  {from: 'includeElementIndex', id: '#remove-includeelementindex'},
  {from: 'includeNodeIndex', id: 'change-includenodeindex-to-includeelementindex'},
  {from: 'linkTarget', id: 'remove-linktarget'},
  {from: 'plugins', id: 'change-plugins-to-remarkplugins', to: 'remarkPlugins'},
  {from: 'rawSourcePos', id: '#remove-rawsourcepos'},
  {from: 'renderers', id: 'change-renderers-to-components', to: 'components'},
  {from: 'source', id: 'change-source-to-children', to: 'children'},
  {from: 'sourcePos', id: '#remove-sourcepos'},
  {from: 'transformImageUri', id: '#add-urltransform', to: 'urlTransform'},
  {from: 'transformLinkUri', id: '#add-urltransform', to: 'urlTransform'}
]

// --- Pure logic functions (translated from react-markdown) ---

export function createProcessor(options) {
  const rehypePlugins = options.rehypePlugins || emptyPlugins
  const remarkPlugins = options.remarkPlugins || emptyPlugins
  const remarkRehypeOptions = options.remarkRehypeOptions
    ? {...options.remarkRehypeOptions, ...emptyRemarkRehypeOptions}
    : emptyRemarkRehypeOptions

  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, remarkRehypeOptions)
    .use(rehypePlugins)

  return processor
}

function createFile(options) {
  const children = options.children || ''
  const file = new VFile()

  if (typeof children === 'string') {
    file.value = children
  } else {
    throw new Error(
      'Unexpected value `' + children + '` for `children` prop, expected `string`'
    )
  }

  return file
}

export function defaultUrlTransform(value) {
  const colon = value.indexOf(':')
  const questionMark = value.indexOf('?')
  const numberSign = value.indexOf('#')
  const slash = value.indexOf('/')

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value
  }

  return ''
}

// --- post function (HAST post-processing + VNode conversion) ---

function post(tree, options) {
  const allowedElements = options.allowedElements
  const allowElement = options.allowElement
  const components = options.components
  const disallowedElements = options.disallowedElements
  const skipHtml = options.skipHtml
  const unwrapDisallowed = options.unwrapDisallowed
  const urlTransform = options.urlTransform === null
    ? null
    : (options.urlTransform || defaultUrlTransform)

  for (const deprecation of deprecations) {
    if (Object.hasOwn(options, deprecation.from)) {
      throw new Error(
        'Unexpected `' +
          deprecation.from +
          '` prop, ' +
          (deprecation.to
            ? 'use `' + deprecation.to + '` instead'
            : 'remove it') +
          ' (see <' +
          changelog +
          '#' +
          deprecation.id +
          '> for more info)'
      )
    }
  }

  if (allowedElements && disallowedElements) {
    throw new Error(
      'Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other'
    )
  }

  visit(tree, transform)

  return toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
    elementAttributeNameCase: 'html'
  })

  function transform(node, index, parent) {
    if (node.type === 'raw' && parent && typeof index === 'number') {
      if (skipHtml) {
        parent.children.splice(index, 1)
      } else {
        parent.children[index] = {type: 'text', value: node.value}
      }
      return index
    }

    if (node.type === 'element') {
      let key
      for (key in urlAttributes) {
        if (
          Object.hasOwn(urlAttributes, key) &&
          Object.hasOwn(node.properties, key)
        ) {
          const value = node.properties[key]
          const test = urlAttributes[key]
          if (test === null || test.includes(node.tagName)) {
            if (urlTransform) {
              node.properties[key] = urlTransform(String(value || ''), key, node)
            }
          }
        }
      }
    }

    if (node.type === 'element') {
      let remove = allowedElements
        ? !allowedElements.includes(node.tagName)
        : disallowedElements
          ? disallowedElements.includes(node.tagName)
          : false

      if (!remove && allowElement && typeof index === 'number') {
        remove = !allowElement(node, index, parent)
      }

      if (remove && parent && typeof index === 'number') {
        if (unwrapDisallowed && node.children) {
          parent.children.splice(index, 1, ...node.children)
        } else {
          parent.children.splice(index, 1)
        }
        return index
      }
    }
  }
}

export { createProcessor, createFile, post }

// --- VueMarkdown synchronous component ---

const optionProps = {
  children: { type: String, default: '' },
  remarkPlugins: { type: Array, default: null },
  rehypePlugins: { type: Array, default: null },
  remarkRehypeOptions: { type: Object, default: null },
  components: { type: Object, default: null },
  allowedElements: { type: Array, default: null },
  disallowedElements: { type: Array, default: null },
  allowElement: { type: Function, default: null },
  unwrapDisallowed: { type: Boolean, default: false },
  skipHtml: { type: Boolean, default: false },
  urlTransform: { type: Function, default: undefined }
}

const VueMarkdown = defineComponent({
  name: 'VueMarkdown',
  props: optionProps,
  setup(props) {
    return () => {
      const processor = createProcessor(props)
      const file = createFile(props)
      return post(processor.runSync(processor.parse(file), file), props)
    }
  }
})
export default VueMarkdown

export function VueMarkdownAsync(options) {
  return defineAsyncComponent(() => {
    const processor = createProcessor(options)
    const file = createFile(options)
    return processor.run(processor.parse(file), file).then(tree => ({
      setup() {
        return () => post(tree, options)
      }
    }))
  })
}

export const VueMarkdownHooks = defineComponent({
  name: 'VueMarkdownHooks',
  props: {
    ...optionProps,
    fallback: { default: null }
  },
  setup(props, { slots }) {
    const processor = computed(() => {
      // Depend only on plugin-related props, matching react-markdown's useMemo deps:
      // [options.rehypePlugins, options.remarkPlugins, options.remarkRehypeOptions]
      void props.rehypePlugins
      void props.remarkPlugins
      void props.remarkRehypeOptions
      return createProcessor(props)
    })
    const tree = shallowRef(undefined)
    const error = ref(undefined)

    watchEffect((onCleanup) => {
      let cancelled = false
      onCleanup(() => { cancelled = true })

      const file = createFile(props)
      processor.value.run(processor.value.parse(file), file, (err, result) => {
        if (!cancelled) {
          error.value = err
          tree.value = result
        }
      })
    })

    return () => {
      if (error.value) throw error.value
      if (tree.value) return post(tree.value, props)
      // fallback: slot first, then prop
      return slots.fallback?.() ?? props.fallback ?? null
    }
  }
})
