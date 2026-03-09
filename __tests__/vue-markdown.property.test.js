import {describe, it, expect} from 'vitest'
import fc from 'fast-check'
import {defaultUrlTransform, createProcessor, createFile, post} from '../lib/index.js'
import {visit} from 'unist-util-visit'

// Feature: vue-markdown, Property 11: defaultUrlTransform protocol safety
// **Validates: Requirements 7.2, 7.3, 10.3**
describe('Property 11: defaultUrlTransform protocol safety', () => {
  const safeProtocols = ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp']

  it('returns original URL for safe protocols', () => {
    const safeProtocolArb = fc.constantFrom(...safeProtocols)
    const pathArb = fc.webPath()

    fc.assert(
      fc.property(safeProtocolArb, pathArb, (protocol, path) => {
        const url = `${protocol}:${path}`
        const result = defaultUrlTransform(url)
        expect(result).toBe(url)
      }),
      {numRuns: 100}
    )
  })

  it('returns empty string for unsafe protocols', () => {
    const unsafeProtocols = ['javascript', 'data', 'vbscript', 'file', 'ftp', 'blob', 'custom']
    const unsafeProtocolArb = fc.constantFrom(...unsafeProtocols)
    const suffixArb = fc.string({minLength: 0, maxLength: 50})

    fc.assert(
      fc.property(unsafeProtocolArb, suffixArb, (protocol, suffix) => {
        const url = `${protocol}:${suffix}`
        const result = defaultUrlTransform(url)
        expect(result).toBe('')
      }),
      {numRuns: 100}
    )
  })

  it('returns original URL for relative URLs (no protocol)', () => {
    // Generate relative URLs: paths, fragments, query strings
    // A URL is "relative" if the colon either doesn't exist, or appears after a /, ?, or #
    const relativeUrlArb = fc.oneof(
      fc.webPath(),
      fc.constant('/relative/path'),
      fc.constant('#fragment'),
      fc.constant('?query=1'),
      fc.constant('relative/path'),
      fc.string({minLength: 0, maxLength: 30}).filter(s => {
        const colon = s.indexOf(':')
        if (colon === -1) return true
        const slash = s.indexOf('/')
        const question = s.indexOf('?')
        const hash = s.indexOf('#')
        return (slash !== -1 && colon > slash) ||
               (question !== -1 && colon > question) ||
               (hash !== -1 && colon > hash)
      })
    )

    fc.assert(
      fc.property(relativeUrlArb, (url) => {
        const result = defaultUrlTransform(url)
        expect(result).toBe(url)
      }),
      {numRuns: 100}
    )
  })

  it('for any string, returns either original or empty string', () => {
    fc.assert(
      fc.property(fc.string({maxLength: 200}), (url) => {
        const result = defaultUrlTransform(url)
        expect(result === url || result === '').toBe(true)
      }),
      {numRuns: 100}
    )
  })
})


// Feature: vue-markdown, Property 6: remarkRehypeOptions always preserves allowDangerousHtml
// **Validates: Requirements 4.4**
describe('Property 6: remarkRehypeOptions always preserves allowDangerousHtml', () => {
  it('merged options always have allowDangerousHtml: true regardless of user input', () => {
    // We test by creating a processor with various remarkRehypeOptions and then
    // processing markdown with inline HTML. If allowDangerousHtml is true,
    // the HAST tree will contain raw nodes. We verify this by using a rehype
    // plugin that inspects the tree.
    const optionsArb = fc.record({
      allowDangerousHtml: fc.oneof(fc.constant(false), fc.constant(true), fc.constant(undefined)),
      footnoteLabel: fc.option(fc.string({minLength: 1, maxLength: 10}), {nil: undefined}),
      footnoteBackLabel: fc.option(fc.string({minLength: 1, maxLength: 10}), {nil: undefined})
    })

    fc.assert(
      fc.property(optionsArb, (userOptions) => {
        // Clean undefined values
        const cleanOptions = {}
        for (const [k, v] of Object.entries(userOptions)) {
          if (v !== undefined) cleanOptions[k] = v
        }

        const processor = createProcessor({
          remarkRehypeOptions: Object.keys(cleanOptions).length > 0 ? cleanOptions : null,
          rehypePlugins: []
        })

        // Markdown with inline HTML - if allowDangerousHtml is true, this produces raw nodes
        const file = createFile({children: 'Hello <strong>world</strong>'})
        const mdast = processor.parse(file)
        const hast = processor.runSync(mdast, file)

        // Walk the HAST tree to find raw nodes
        function findRaw(node) {
          if (node.type === 'raw') return true
          if (node.children) {
            return node.children.some(findRaw)
          }
          return false
        }

        // If allowDangerousHtml is true, inline HTML produces raw nodes
        // The key assertion: raw nodes should exist because allowDangerousHtml
        // is always forced to true
        const hasRaw = findRaw(hast)
        expect(hasRaw).toBe(true)
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 5: Plugin execution order
// **Validates: Requirements 4.1, 4.2, 4.3**
describe('Property 5: Plugin execution order', () => {
  it('plugins execute in order: remarkParse �?remarkPlugins �?remarkRehype �?rehypePlugins', () => {
    // Generate random counts of remark and rehype plugins
    const pluginCountArb = fc.record({
      remarkCount: fc.integer({min: 1, max: 4}),
      rehypeCount: fc.integer({min: 1, max: 4})
    })

    fc.assert(
      fc.property(pluginCountArb, ({remarkCount, rehypeCount}) => {
        const executionOrder = []

        // Create tracking remark plugins (operate on MDAST)
        const remarkPlugins = Array.from({length: remarkCount}, (_, i) => {
          return function remarkTracker() {
            return (tree) => {
              executionOrder.push(`remark-${i}`)
              return tree
            }
          }
        })

        // Create tracking rehype plugins (operate on HAST)
        const rehypePlugins = Array.from({length: rehypeCount}, (_, i) => {
          return function rehypeTracker() {
            return (tree) => {
              executionOrder.push(`rehype-${i}`)
              return tree
            }
          }
        })

        const processor = createProcessor({
          remarkPlugins,
          rehypePlugins
        })

        const file = createFile({children: '# Hello'})
        const mdast = processor.parse(file)
        processor.runSync(mdast, file)

        // Verify order: all remark plugins before all rehype plugins
        const remarkIndices = executionOrder
          .map((entry, idx) => entry.startsWith('remark-') ? idx : -1)
          .filter(idx => idx !== -1)
        const rehypeIndices = executionOrder
          .map((entry, idx) => entry.startsWith('rehype-') ? idx : -1)
          .filter(idx => idx !== -1)

        // All remark plugins should execute before any rehype plugin
        if (remarkIndices.length > 0 && rehypeIndices.length > 0) {
          const lastRemark = Math.max(...remarkIndices)
          const firstRehype = Math.min(...rehypeIndices)
          expect(lastRemark).toBeLessThan(firstRehype)
        }

        // Remark plugins should be in order
        for (let i = 0; i < remarkCount; i++) {
          expect(executionOrder[i]).toBe(`remark-${i}`)
        }

        // Rehype plugins should be in order
        for (let i = 0; i < rehypeCount; i++) {
          expect(executionOrder[remarkCount + i]).toBe(`rehype-${i}`)
        }

        // Total count should match
        expect(executionOrder.length).toBe(remarkCount + rehypeCount)
      }),
      {numRuns: 100}
    )
  })
})


// Feature: vue-markdown, Property 8: Element filtering
// **Validates: Requirements 6.1, 6.2**
describe('Property 8: Element filtering', () => {
  // Helper: collect all element tagNames from a VNode tree
  function collectTags(vnode) {
    const tags = new Set()
    function walk(node) {
      if (!node) return
      if (typeof node === 'string') return
      if (typeof node.type === 'string' && node.type !== Symbol.for('v-fgt') && node.type !== 'Symbol(v-fgt)') {
        tags.add(node.type)
      }
      const children = node.children ?? node.props?.children
      if (Array.isArray(children)) {
        children.forEach(walk)
      } else if (children && typeof children === 'object') {
        walk(children)
      }
    }
    walk(vnode)
    return tags
  }

  // Helper: build a HAST tree from markdown
  function buildHast(md) {
    const processor = createProcessor({})
    const file = createFile({children: md})
    return processor.runSync(processor.parse(file), file)
  }

  it('allowedElements: output only contains allowed tags', () => {
    // Markdown that produces known elements: p, strong, a, em
    const markdownArb = fc.constantFrom(
      '**bold** and *italic*',
      '[link](http://example.com) and **strong**',
      '# heading\n\nparagraph with **bold**',
      '- item1\n- item2',
      '> blockquote with **bold**',
      '`code` and **bold** and *em*'
    )

    // Pick a subset of common HTML tags to allow
    const allTags = ['p', 'strong', 'em', 'a', 'h1', 'ul', 'li', 'blockquote', 'code']
    const allowedArb = fc.subarray(allTags, {minLength: 1})

    fc.assert(
      fc.property(markdownArb, allowedArb, (md, allowed) => {
        const tree = buildHast(md)

        const vnode = post(tree, {allowedElements: allowed})
        const tags = collectTags(vnode)
        for (const tag of tags) {
          expect(allowed).toContain(tag)
        }
      }),
      {numRuns: 100}
    )
  })

  it('disallowedElements: output does not contain disallowed tags', () => {
    const markdownArb = fc.constantFrom(
      '**bold** and *italic*',
      '[link](http://example.com) and **strong**',
      '# heading\n\nparagraph with **bold**',
      '- item1\n- item2',
      '> blockquote with **bold**'
    )

    const allTags = ['strong', 'em', 'a', 'h1', 'ul', 'li', 'blockquote']
    const disallowedArb = fc.subarray(allTags, {minLength: 1})

    fc.assert(
      fc.property(markdownArb, disallowedArb, (md, disallowed) => {
        const tree = buildHast(md)

        const vnode = post(tree, {disallowedElements: disallowed})
        const tags = collectTags(vnode)
        for (const tag of disallowed) {
          expect(tags.has(tag)).toBe(false)
        }
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 9: allowElement callback post-filtering
// **Validates: Requirements 6.4**
describe('Property 9: allowElement callback post-filtering', () => {
  function buildHast(md) {
    const processor = createProcessor({})
    const file = createFile({children: md})
    return processor.runSync(processor.parse(file), file)
  }

  it('allowElement callback is only invoked on elements that passed allowedElements filter', () => {
    const markdownArb = fc.constantFrom(
      '**bold** and *italic* and [link](http://x.com)',
      '# heading\n\n**strong** text *em*',
      '- list **bold** item'
    )

    // Allow only a subset of tags
    const allowedArb = fc.constantFrom(
      ['p', 'strong'],
      ['p', 'em'],
      ['p', 'a'],
      ['p', 'strong', 'em'],
      ['p', 'strong', 'a', 'em']
    )

    fc.assert(
      fc.property(markdownArb, allowedArb, (md, allowed) => {
        const tree = buildHast(md)

        const callbackCalledWith = []

        const allowElement = (element, index, parent) => {
          callbackCalledWith.push(element.tagName)
          return true // allow all that reach here
        }

        post(tree, {allowedElements: allowed, allowElement})

        // Every element the callback was called with must be in the allowed list
        for (const tag of callbackCalledWith) {
          expect(allowed).toContain(tag)
        }
      }),
      {numRuns: 100}
    )
  })

  it('elements rejected by allowElement callback do not appear in output', () => {
    const markdownArb = fc.constantFrom(
      '**bold** and *italic*',
      '[link](http://x.com) and **strong**',
      '# heading\n\nparagraph'
    )

    // Reject a specific tag via callback
    const rejectTagArb = fc.constantFrom('strong', 'em', 'a', 'h1', 'p')

    fc.assert(
      fc.property(markdownArb, rejectTagArb, (md, rejectTag) => {
        const tree = buildHast(md)


        function collectTags(vnode) {
          const tags = new Set()
          function walk(node) {
            if (!node) return
            if (typeof node === 'string') return
            if (typeof node.type === 'string') tags.add(node.type)
            const children = node.children ?? node.props?.children
            if (Array.isArray(children)) children.forEach(walk)
            else if (children && typeof children === 'object') walk(children)
          }
          walk(vnode)
          return tags
        }

        const vnode = post(tree, {
          allowElement: (element) => element.tagName !== rejectTag
        })

        const tags = collectTags(vnode)
        expect(tags.has(rejectTag)).toBe(false)
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 10: unwrapDisallowed controls child preservation
// **Validates: Requirements 6.5, 6.6**
describe('Property 10: unwrapDisallowed controls child preservation', () => {
  function buildHast(md) {
    const processor = createProcessor({})
    const file = createFile({children: md})
    return processor.runSync(processor.parse(file), file)
  }

  function collectTextContent(vnode) {
    const texts = []
    function walk(node) {
      if (!node) return
      if (typeof node === 'string') {
        texts.push(node)
        return
      }
      const children = node.children ?? node.props?.children
      if (Array.isArray(children)) children.forEach(walk)
      else if (children && typeof children === 'object') walk(children)
      else if (typeof children === 'string') texts.push(children)
    }
    walk(vnode)
    return texts.join('')
  }

  it('unwrapDisallowed=true preserves children of filtered elements', () => {
    // Use markdown with nested elements where we filter the wrapper
    const markdownArb = fc.constantFrom(
      '**bold text**',
      '*italic text*',
      '**bold** and *italic*'
    )

    fc.assert(
      fc.property(markdownArb, (md) => {
        const tree = buildHast(md)


        // Filter out strong/em but keep children (unwrap)
        const vnode = post(tree, {
          disallowedElements: ['strong', 'em'],
          unwrapDisallowed: true
        })

        const text = collectTextContent(vnode)
        // The text content should still be present since children are preserved
        if (md.includes('bold text')) expect(text).toContain('bold text')
        if (md.includes('italic text')) expect(text).toContain('italic text')
        if (md.includes('bold') && md.includes('italic')) {
          expect(text).toContain('bold')
          expect(text).toContain('italic')
        }
      }),
      {numRuns: 100}
    )
  })

  it('unwrapDisallowed=false removes both element and children', () => {
    const markdownArb = fc.constantFrom(
      '**bold text**',
      '*italic text*',
      '**bold** and *italic*'
    )

    fc.assert(
      fc.property(markdownArb, (md) => {
        const tree = buildHast(md)


        function collectTags(vnode) {
          const tags = new Set()
          function walk(node) {
            if (!node) return
            if (typeof node === 'string') return
            if (typeof node.type === 'string') tags.add(node.type)
            const children = node.children ?? node.props?.children
            if (Array.isArray(children)) children.forEach(walk)
            else if (children && typeof children === 'object') walk(children)
          }
          walk(vnode)
          return tags
        }

        // Filter out strong/em WITHOUT unwrap - children should be removed too
        const vnode = post(tree, {
          disallowedElements: ['strong', 'em'],
          unwrapDisallowed: false
        })

        const tags = collectTags(vnode)
        expect(tags.has('strong')).toBe(false)
        expect(tags.has('em')).toBe(false)

        const text = collectTextContent(vnode)
        // When unwrapDisallowed is false, the text inside filtered elements is removed
        if (md === '**bold text**') expect(text).not.toContain('bold text')
        if (md === '*italic text*') expect(text).not.toContain('italic text')
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 13: skipHtml controls raw node handling
// **Validates: Requirements 8.1, 8.2**
describe('Property 13: skipHtml controls raw node handling', () => {
  function buildHast(md) {
    // remarkRehypeOptions with allowDangerousHtml is always true by default
    const processor = createProcessor({})
    const file = createFile({children: md})
    return processor.runSync(processor.parse(file), file)
  }

  function collectTextContent(vnode) {
    const texts = []
    function walk(node) {
      if (!node) return
      if (typeof node === 'string') {
        texts.push(node)
        return
      }
      const children = node.children ?? node.props?.children
      if (Array.isArray(children)) children.forEach(walk)
      else if (children && typeof children === 'object') walk(children)
      else if (typeof children === 'string') texts.push(children)
    }
    walk(vnode)
    return texts.join('')
  }

  it('skipHtml=true removes raw HTML nodes from output', () => {
    // Markdown with inline HTML that produces raw nodes
    const markdownArb = fc.constantFrom(
      'Hello <b>world</b>',
      'Text <em>emphasis</em> more',
      '<span>inline</span> html',
      'Before <div>block</div> after'
    )

    fc.assert(
      fc.property(markdownArb, (md) => {
        const tree = buildHast(md)


        const vnode = post(tree, {skipHtml: true})
        const text = collectTextContent(vnode)

        // Raw HTML tags should be removed - the tag text itself should not appear
        expect(text).not.toContain('<b>')
        expect(text).not.toContain('</b>')
        expect(text).not.toContain('<em>')
        expect(text).not.toContain('</em>')
        expect(text).not.toContain('<span>')
        expect(text).not.toContain('</span>')
        expect(text).not.toContain('<div>')
        expect(text).not.toContain('</div>')
      }),
      {numRuns: 100}
    )
  })

  it('skipHtml=false converts raw HTML nodes to text nodes (preserving content)', () => {
    const markdownArb = fc.constantFrom(
      'Hello <b>world</b>',
      'Text <em>emphasis</em> more',
      '<span>inline</span> html'
    )

    fc.assert(
      fc.property(markdownArb, (md) => {
        const tree = buildHast(md)


        const vnode = post(tree, {skipHtml: false})
        const text = collectTextContent(vnode)

        // When skipHtml is false, raw nodes become text nodes
        // The raw HTML markup should appear as text in the output
        // Extract the HTML tags from the markdown
        const tagMatches = md.match(/<\/?[a-z]+>/g) || []
        for (const tag of tagMatches) {
          expect(text).toContain(tag)
        }
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 14: Deprecated props produce migration errors
// **Validates: Requirements 10.4**
describe('Property 14: Deprecated props produce migration errors', () => {
  const allDeprecations = [
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

  it('each deprecated prop throws an error with the prop name and migration guidance', () => {
    const deprecationArb = fc.constantFrom(...allDeprecations)

    fc.assert(
      fc.property(deprecationArb, (deprecation) => {


        // Build a minimal valid HAST tree
        const tree = {
          type: 'root',
          children: [{type: 'text', value: 'test'}]
        }

        const options = {[deprecation.from]: 'some-value'}

        expect(() => post(tree, options)).toThrow(
          new RegExp(`Unexpected \`${deprecation.from}\` prop`)
        )

        // Also verify the error contains migration guidance
        try {
          post(tree, options)
        } catch (e) {
          expect(e.message).toContain(deprecation.from)
          if (deprecation.to) {
            expect(e.message).toContain(deprecation.to)
            expect(e.message).toContain('use `' + deprecation.to + '` instead')
          } else {
            expect(e.message).toContain('remove it')
          }
          expect(e.message).toContain(deprecation.id)
        }
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 12: urlTransform configuration
// **Validates: Requirements 7.1, 7.4, 7.5**
describe('Property 12: urlTransform configuration', () => {
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

  it('default urlTransform applies defaultUrlTransform (blocks unsafe protocols)', () => {
    // Markdown with links using various protocols
    const urlArb = fc.constantFrom(
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'vbscript:msgbox'
    )

    fc.assert(
      fc.property(urlArb, (unsafeUrl) => {
        const md = `[click](${unsafeUrl})`
        const tree = buildHast(md)


        // No urlTransform provided �?defaultUrlTransform is used
        const vnode = post(tree, {})
        const hrefs = collectHrefs(vnode)

        // Unsafe URLs should be transformed to empty string
        for (const href of hrefs) {
          expect(href).toBe('')
        }
      }),
      {numRuns: 100}
    )
  })

  it('custom urlTransform function is used when provided', () => {
    const prefixArb = fc.string({minLength: 1, maxLength: 10}).filter(s => /^[a-z]+$/.test(s))

    fc.assert(
      fc.property(prefixArb, (prefix) => {
        const md = '[link](http://example.com)'
        const tree = buildHast(md)


        const customTransform = (url) => prefix + '-' + url

        const vnode = post(tree, {urlTransform: customTransform})
        const hrefs = collectHrefs(vnode)

        // Custom transform should have been applied
        for (const href of hrefs) {
          expect(href.startsWith(prefix + '-')).toBe(true)
        }
      }),
      {numRuns: 100}
    )
  })

  it('urlTransform=null passes URLs through unchanged', () => {
    const urlArb = fc.constantFrom(
      'http://example.com',
      'https://test.org/path',
      'javascript:alert(1)',
      'data:text/html,test',
      '/relative/path'
    )

    fc.assert(
      fc.property(urlArb, (url) => {
        const md = `[link](${url})`
        const tree = buildHast(md)


        const vnode = post(tree, {urlTransform: null})
        const hrefs = collectHrefs(vnode)

        // With null urlTransform, URLs pass through unchanged
        if (hrefs.length > 0) {
          expect(hrefs[0]).toBe(url)
        }
      }),
      {numRuns: 100}
    )
  })
})

// --- Tests for Task 5: VueMarkdown component ---

import {mount} from '@vue/test-utils'
import VueMarkdown from '../lib/index.js'
import {defineComponent, h, markRaw} from 'vue'

// Feature: vue-markdown, Property 1: Sync rendering produces valid VNode
// **Validates: Requirements 1.1**
describe('Property 1: Sync rendering produces valid VNode', () => {
  it('for any valid Markdown string, VueMarkdown renders without errors and produces HTML output', () => {
    const markdownArb = fc.oneof(
      fc.constant('# Hello World'),
      fc.constant('**bold** and *italic*'),
      fc.constant('[link](http://example.com)'),
      fc.constant('- item1\n- item2\n- item3'),
      fc.constant('> blockquote text'),
      fc.constant('`inline code`'),
      fc.constant('```\ncode block\n```'),
      fc.constant('Hello\n\nWorld'),
      fc.constant(''),
      fc.string({minLength: 0, maxLength: 200})
    )

    fc.assert(
      fc.property(markdownArb, (md) => {
        const wrapper = mount(VueMarkdown, {
          props: {children: md}
        })

        // Should not throw and should produce some HTML output
        expect(wrapper.exists()).toBe(true)
        // The component should have rendered something (at least an empty fragment)
        expect(wrapper.html()).toBeDefined()
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 3: Non-string children rejection
// **Validates: Requirements 1.3**
describe('Property 3: Non-string children rejection', () => {
  it('for any truthy non-string value, createFile throws an error about expecting a string', () => {
    // createFile uses `options.children || ''` which coerces falsy values (false, 0, null, undefined)
    // to empty string. So we only test truthy non-string values that bypass the || guard.
    const truthyNonStringArb = fc.oneof(
      fc.integer({min: 1}),
      fc.double({min: 0.1, noNaN: true}),
      fc.constant(true),
      fc.array(fc.anything(), {minLength: 1, maxLength: 3}),
      fc.dictionary(fc.string({minLength: 1, maxLength: 5}), fc.anything(), {minKeys: 1, maxKeys: 3}),
      fc.constant([1, 2, 3]),
      fc.constant({key: 'value'})
    )

    fc.assert(
      fc.property(truthyNonStringArb, (value) => {
        expect(() => createFile({children: value})).toThrow(/expected `string`/i)
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 4: Custom components receive HAST node
// **Validates: Requirements 1.6, 5.3**
describe('Property 4: Custom components receive HAST node', () => {
  it('custom component receives a node prop that is a valid HAST Element node', () => {
    // Map various tags to custom components and verify node prop
    const tagArb = fc.constantFrom('p', 'strong', 'em', 'a', 'h1', 'blockquote')
    const markdownForTag = {
      p: 'Hello world',
      strong: '**bold text**',
      em: '*italic text*',
      a: '[link](http://example.com)',
      h1: '# Heading',
      blockquote: '> quote'
    }

    fc.assert(
      fc.property(tagArb, (tag) => {
        const receivedNodes = []

        const CustomComponent = defineComponent({
          props: {node: {type: Object, default: null}},
          setup(props, {slots}) {
            return () => {
              if (props.node) {
                receivedNodes.push(props.node)
              }
              return h(tag, {}, slots.default ? slots.default() : undefined)
            }
          }
        })

        const md = markdownForTag[tag]
        mount(VueMarkdown, {
          props: {
            children: md,
            components: {[tag]: CustomComponent}
          }
        })

        // At least one node should have been received
        expect(receivedNodes.length).toBeGreaterThan(0)

        for (const node of receivedNodes) {
          // Should be a valid HAST Element node
          expect(node.type).toBe('element')
          expect(node.tagName).toBe(tag)
          expect(node).toHaveProperty('properties')
          expect(node).toHaveProperty('children')
        }
      }),
      {numRuns: 100}
    )
  })
})

// Feature: vue-markdown, Property 7: Component mapping substitution
// **Validates: Requirements 5.1, 5.2**
describe('Property 7: Component mapping substitution', () => {
  it('string tag name mappings cause the output to use the mapped tag', () => {
    // Map one tag to another string tag name
    const mappingArb = fc.constantFrom(
      {from: 'p', to: 'div', md: 'Hello world'},
      {from: 'strong', to: 'span', md: '**bold**'},
      {from: 'em', to: 'span', md: '*italic*'},
      {from: 'h1', to: 'div', md: '# Heading'},
      {from: 'blockquote', to: 'section', md: '> quote'},
      {from: 'a', to: 'span', md: '[link](http://example.com)'}
    )

    fc.assert(
      fc.property(mappingArb, ({from, to, md}) => {
        const wrapper = mount(VueMarkdown, {
          props: {
            children: md,
            components: {[from]: to}
          }
        })

        const html = wrapper.html()
        // The mapped tag should appear in the output
        expect(html).toContain(`<${to}`)
        // The original tag should NOT appear in the output
        expect(html).not.toContain(`<${from}`)
      }),
      {numRuns: 100}
    )
  })

  it('Vue component mappings cause the output to use the mapped component', () => {
    const tagArb = fc.constantFrom('p', 'strong', 'em')
    const markdownForTag = {
      p: 'Hello world',
      strong: '**bold text**',
      em: '*italic text*'
    }

    fc.assert(
      fc.property(tagArb, (tag) => {
        let componentRendered = false

        const CustomComponent = defineComponent({
          props: {node: {type: Object, default: null}},
          setup(props, {slots}) {
            return () => {
              componentRendered = true
              return h('article', {class: 'custom'}, slots.default ? slots.default() : undefined)
            }
          }
        })

        componentRendered = false
        const wrapper = mount(VueMarkdown, {
          props: {
            children: markdownForTag[tag],
            components: {[tag]: CustomComponent}
          }
        })

        // The custom component should have been rendered
        expect(componentRendered).toBe(true)
        // The output should contain the custom component's tag
        expect(wrapper.html()).toContain('<article')
        expect(wrapper.html()).toContain('class="custom"')
      }),
      {numRuns: 100}
    )
  })
})


// --- Tests for Task 6: VueMarkdownAsync component ---

import {VueMarkdownAsync} from '../lib/index.js'
import {Suspense} from 'vue'
import {flushPromises} from '@vue/test-utils'

// Feature: vue-markdown, Property 2: Sync/Async output equivalence
// **Validates: Requirements 2.1**
describe('Property 2: Sync/Async output equivalence', () => {
  // Wrapper component to test async components inside Suspense
  const AsyncWrapper = defineComponent({
    props: {asyncComponent: {type: Object, required: true}},
    setup(props) {
      return () => h(Suspense, null, {
        default: () => h(props.asyncComponent),
        fallback: () => h('div', 'loading...')
      })
    }
  })

  it('for the same markdown, VueMarkdown and VueMarkdownAsync produce equivalent HTML output', async () => {
    const markdownArb = fc.constantFrom(
      '# Hello World',
      '**bold** and *italic*',
      '[link](http://example.com)',
      '- item1\n- item2\n- item3',
      '> blockquote text',
      '`inline code`',
      'Hello\n\nWorld',
      '## Heading 2\n\nSome paragraph with **bold** text.'
    )

    // We need to run each case sequentially because of async resolution
    const samples = fc.sample(markdownArb, 100)

    for (const md of samples) {
      // Sync render
      const syncWrapper = mount(VueMarkdown, {
        props: {children: md}
      })
      const syncHtml = syncWrapper.html()

      // Async render
      const asyncComponent = markRaw(VueMarkdownAsync({children: md}))
      const asyncWrapper = mount(AsyncWrapper, {
        props: {asyncComponent}
      })
      await flushPromises()
      const asyncHtml = asyncWrapper.html()

      expect(asyncHtml).toBe(syncHtml)
    }
  })

  it('with plugins, sync and async produce equivalent output', async () => {
    // A simple remark plugin that adds a class to all paragraphs (rehype plugin)
    function addClassPlugin() {
      return (tree) => {
        visit(tree, 'element', (node) => {
          if (node.tagName === 'p') {
            node.properties = node.properties || {}
            node.properties.className = ['test-class']
          }
        })
      }
    }

    const markdownArb = fc.constantFrom(
      'Hello world',
      '**bold** text',
      'Paragraph one\n\nParagraph two'
    )

    const samples = fc.sample(markdownArb, 30)

    for (const md of samples) {
      const pluginOptions = {
        children: md,
        rehypePlugins: [addClassPlugin]
      }

      // Sync render
      const syncWrapper = mount(VueMarkdown, {
        props: pluginOptions
      })
      const syncHtml = syncWrapper.html()

      // Async render
      const asyncComponent = markRaw(VueMarkdownAsync(pluginOptions))
      const asyncWrapper = mount(AsyncWrapper, {
        props: {asyncComponent}
      })
      await flushPromises()
      const asyncHtml = asyncWrapper.html()

      expect(asyncHtml).toBe(syncHtml)
    }
  })
})


// --- Tests for Task 7: VueMarkdownHooks component ---

import {VueMarkdownHooks} from '../lib/index.js'

// Feature: vue-markdown, Property 15: VueMarkdownHooks reactivity
// **Validates: Requirements 3.3**
describe('Property 15: VueMarkdownHooks reactivity', () => {
  it('when children changes, VueMarkdownHooks eventually renders the output corresponding to the new string', async () => {
    // Generate pairs of different markdown strings
    const markdownPairArb = fc.tuple(
      fc.constantFrom(
        '# First Heading',
        '**bold first**',
        'First paragraph',
        '- first item',
        '> first quote',
        '`first code`'
      ),
      fc.constantFrom(
        '# Second Heading',
        '**bold second**',
        'Second paragraph',
        '- second item',
        '> second quote',
        '`second code`'
      )
    ).filter(([a, b]) => a !== b)

    const samples = fc.sample(markdownPairArb, 100)

    for (const [first, second] of samples) {
      // Mount VueMarkdownHooks with the first markdown
      const wrapper = mount(VueMarkdownHooks, {
        props: { children: first }
      })
      await flushPromises()

      // Verify initial render matches sync output
      const syncFirst = mount(VueMarkdown, { props: { children: first } })
      expect(wrapper.html()).toBe(syncFirst.html())

      // Update children prop
      await wrapper.setProps({ children: second })
      await flushPromises()

      // Verify updated render matches sync output for the second string
      const syncSecond = mount(VueMarkdown, { props: { children: second } })
      expect(wrapper.html()).toBe(syncSecond.html())
    }
  })
})
