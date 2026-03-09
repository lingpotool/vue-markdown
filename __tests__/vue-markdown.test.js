import {describe, it, expect, vi} from 'vitest'
import {mount, flushPromises} from '@vue/test-utils'
import VueMarkdown, {VueMarkdownAsync, VueMarkdownHooks, defaultUrlTransform} from '../index.js'
import {post, createProcessor, createFile} from '../lib/index.js'
import {defineComponent, h, Suspense, nextTick, markRaw} from 'vue'

// ============================================================
// Task 9.1: 核心行为和边界情况
// ============================================================
describe('Task 9.1: Core behavior and edge cases', () => {
  // --- Requirements 1.2: empty/undefined children render empty Fragment ---
  describe('empty/undefined children render empty Fragment (Requirements 1.2)', () => {
    it('empty string children renders empty output', () => {
      const wrapper = mount(VueMarkdown, {
        props: {children: ''}
      })
      expect(wrapper.html()).toBe('')
    })

    it('default children (not provided) renders empty output', () => {
      const wrapper = mount(VueMarkdown)
      expect(wrapper.html()).toBe('')
    })
  })

  // --- Requirements 6.3: allowedElements + disallowedElements throws ---
  describe('allowedElements and disallowedElements together throws (Requirements 6.3)', () => {
    it('throws when both allowedElements and disallowedElements are provided', () => {
      expect(() => {
        mount(VueMarkdown, {
          props: {
            children: 'Hello',
            allowedElements: ['p'],
            disallowedElements: ['strong']
          }
        })
      }).toThrow('Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other')
    })
  })

  // --- Requirements 7.5: urlTransform=null means no URL transformation ---
  describe('urlTransform=null disables URL transformation (Requirements 7.5)', () => {
    it('unsafe URLs pass through when urlTransform is null', () => {
      const tree = buildHast('[click](javascript:alert(1))')
      const vnode = post(tree, {urlTransform: null})
      const hrefs = collectHrefs(vnode)
      expect(hrefs.length).toBeGreaterThan(0)
      expect(hrefs[0]).toBe('javascript:alert(1)')
    })
  })

  // --- Requirements 9.1: module exports ---
  describe('module exports (Requirements 9.1)', () => {
    it('default export is VueMarkdown component', () => {
      expect(VueMarkdown).toBeDefined()
      expect(VueMarkdown.name).toBe('VueMarkdown')
    })

    it('VueMarkdownAsync is exported as a function', () => {
      expect(VueMarkdownAsync).toBeDefined()
      expect(typeof VueMarkdownAsync).toBe('function')
    })

    it('VueMarkdownHooks is exported as a component', () => {
      expect(VueMarkdownHooks).toBeDefined()
      expect(VueMarkdownHooks.name).toBe('VueMarkdownHooks')
    })

    it('defaultUrlTransform is exported as a function', () => {
      expect(defaultUrlTransform).toBeDefined()
      expect(typeof defaultUrlTransform).toBe('function')
    })
  })
})


// ============================================================
// Task 9.2: 异步组件行为
// ============================================================
describe('Task 9.2: Async component behavior', () => {
  // --- Requirements 2.2: VueMarkdownAsync with Suspense ---
  describe('VueMarkdownAsync renders with Suspense (Requirements 2.2)', () => {
    it('renders markdown content inside Suspense after resolution', async () => {
      const AsyncComp = markRaw(VueMarkdownAsync({children: '**hello**'}))

      const Wrapper = defineComponent({
        setup() {
          return () => h(Suspense, null, {
            default: () => h(AsyncComp),
            fallback: () => h('span', 'loading...')
          })
        }
      })

      const wrapper = mount(Wrapper)
      await flushPromises()
      expect(wrapper.html()).toContain('hello')
    })
  })

  // --- Requirements 3.2: VueMarkdownHooks fallback ---
  describe('VueMarkdownHooks renders fallback (Requirements 3.2)', () => {
    // Create a slow async rehype plugin that delays processing
    function createSlowPlugin(delayMs = 50) {
      return function slowPlugin() {
        return async (tree) => {
          await new Promise(resolve => setTimeout(resolve, delayMs))
          return tree
        }
      }
    }

    it('renders fallback prop initially before async resolution', () => {
      const wrapper = mount(VueMarkdownHooks, {
        props: {
          children: '# Title',
          fallback: h('span', 'loading via prop'),
          rehypePlugins: [createSlowPlugin(100)]
        }
      })
      // Before async resolution, fallback should be shown
      expect(wrapper.html()).toContain('loading via prop')
    })

    it('renders fallback slot initially before async resolution', () => {
      const wrapper = mount(VueMarkdownHooks, {
        props: {
          children: '# Title',
          rehypePlugins: [createSlowPlugin(100)]
        },
        slots: {
          fallback: () => h('span', 'loading via slot')
        }
      })
      expect(wrapper.html()).toContain('loading via slot')
    })

    it('replaces fallback with actual content after resolution', async () => {
      const wrapper = mount(VueMarkdownHooks, {
        props: {
          children: '**bold text**',
          fallback: h('span', 'loading...'),
          rehypePlugins: [createSlowPlugin(20)]
        }
      })
      expect(wrapper.html()).toContain('loading...')
      // Wait for the slow plugin to finish
      await new Promise(resolve => setTimeout(resolve, 50))
      await flushPromises()
      await nextTick()
      expect(wrapper.html()).toContain('bold text')
      expect(wrapper.html()).not.toContain('loading...')
    })
  })

  // --- Requirements 3.4: VueMarkdownHooks cancels stale callbacks ---
  describe('VueMarkdownHooks cancels stale callbacks (Requirements 3.4)', () => {
    it('only renders the last value after rapid children changes', async () => {
      const wrapper = mount(VueMarkdownHooks, {
        props: {children: 'first'}
      })

      await wrapper.setProps({children: 'second'})
      await wrapper.setProps({children: 'third'})
      await wrapper.setProps({children: 'final value'})

      await flushPromises()
      await nextTick()
      await flushPromises()

      const html = wrapper.html()
      expect(html).toContain('final value')
    })
  })

  // --- Requirements 2.3, 3.5: async plugin error propagation ---
  describe('async plugin error propagation (Requirements 2.3, 3.5)', () => {
    const errorPlugin = () => {
      return () => {
        throw new Error('plugin-error-test')
      }
    }

    it('VueMarkdownAsync propagates plugin errors', async () => {
      const AsyncComp = markRaw(VueMarkdownAsync({
        children: 'hello',
        remarkPlugins: [errorPlugin]
      }))

      const errors = []
      const Wrapper = defineComponent({
        setup() {
          return () => h(Suspense, null, {
            default: () => h(AsyncComp),
            fallback: () => h('span', 'loading...')
          })
        }
      })

      const wrapper = mount(Wrapper, {
        global: {
          config: {
            errorHandler(err) {
              errors.push(err)
            }
          }
        }
      })

      await flushPromises()
      await nextTick()
      await flushPromises()

      // The error should have been caught by the error handler
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.message.includes('plugin-error-test'))).toBe(true)
    })

    it('VueMarkdownHooks propagates plugin errors', async () => {
      // The error plugin throws synchronously during processor.run callback
      // inside watchEffect. Vue catches this via callWithAsyncErrorHandling
      // and propagates it. We need to use an async plugin so the error
      // goes through the callback path (err parameter) and gets stored in error ref.
      const asyncErrorPlugin = () => {
        return async () => {
          throw new Error('async-plugin-error-test')
        }
      }

      const errors = []

      const wrapper = mount(VueMarkdownHooks, {
        props: {
          children: 'hello',
          remarkPlugins: [asyncErrorPlugin]
        },
        global: {
          config: {
            errorHandler(err) {
              errors.push(err)
            }
          }
        }
      })

      await flushPromises()
      await nextTick()
      await flushPromises()

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.message.includes('async-plugin-error-test'))).toBe(true)
    })
  })
})


// ============================================================
// Task 9.3: 废弃 prop 错误消息
// ============================================================
describe('Task 9.3: Deprecated prop error messages (Requirements 10.4)', () => {
  const changelog = 'https://github.com/remarkjs/react-markdown/blob/main/changelog.md'

  const deprecations = [
    {from: 'astPlugins', id: 'remove-buggy-html-in-markdown-parser', to: null},
    {from: 'allowDangerousHtml', id: 'remove-buggy-html-in-markdown-parser', to: null},
    {from: 'allowNode', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'allowElement'},
    {from: 'allowedTypes', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'allowedElements'},
    {from: 'className', id: 'remove-classname', to: null},
    {from: 'disallowedTypes', id: 'replace-allownode-allowedtypes-and-disallowedtypes', to: 'disallowedElements'},
    {from: 'escapeHtml', id: 'remove-buggy-html-in-markdown-parser', to: null},
    {from: 'includeElementIndex', id: '#remove-includeelementindex', to: null},
    {from: 'includeNodeIndex', id: 'change-includenodeindex-to-includeelementindex', to: null},
    {from: 'linkTarget', id: 'remove-linktarget', to: null},
    {from: 'plugins', id: 'change-plugins-to-remarkplugins', to: 'remarkPlugins'},
    {from: 'rawSourcePos', id: '#remove-rawsourcepos', to: null},
    {from: 'renderers', id: 'change-renderers-to-components', to: 'components'},
    {from: 'source', id: 'change-source-to-children', to: 'children'},
    {from: 'sourcePos', id: '#remove-sourcepos', to: null},
    {from: 'transformImageUri', id: '#add-urltransform', to: 'urlTransform'},
    {from: 'transformLinkUri', id: '#add-urltransform', to: 'urlTransform'}
  ]

  // Build a minimal HAST tree for post() calls
  const minimalTree = {
    type: 'root',
    children: [{type: 'text', value: 'test'}]
  }

  for (const dep of deprecations) {
    it(`deprecated prop "${dep.from}" throws correct error message`, () => {
      const options = {[dep.from]: 'some-value'}

      expect(() => post(minimalTree, options)).toThrow(
        `Unexpected \`${dep.from}\` prop`
      )

      try {
        post(minimalTree, options)
      } catch (e) {
        // Verify the error contains the deprecated prop name
        expect(e.message).toContain(`\`${dep.from}\``)

        // Verify migration guidance
        if (dep.to) {
          expect(e.message).toContain(`use \`${dep.to}\` instead`)
        } else {
          expect(e.message).toContain('remove it')
        }

        // Verify changelog link
        const expectedUrl = `${changelog}#${dep.id}`
        expect(e.message).toContain(expectedUrl)

        // Verify full message format
        const expectedMessage = dep.to
          ? `Unexpected \`${dep.from}\` prop, use \`${dep.to}\` instead (see <${expectedUrl}> for more info)`
          : `Unexpected \`${dep.from}\` prop, remove it (see <${expectedUrl}> for more info)`
        expect(e.message).toBe(expectedMessage)
      }
    })
  }
})

// ============================================================
// Helpers
// ============================================================
function buildHast(md) {
  const processor = createProcessor({})
  const file = createFile({children: md})
  return processor.runSync(processor.parse(file), file)
}

function collectHrefs(vnode) {
  const hrefs = []
  function walk(node) {
    if (!node) return
    if (typeof node === 'string') return
    if (node.props?.href !== undefined) hrefs.push(node.props.href)
    const children = node.children ?? node.props?.children
    if (Array.isArray(children)) children.forEach(walk)
    else if (children && typeof children === 'object') walk(children)
  }
  walk(vnode)
  return hrefs
}
