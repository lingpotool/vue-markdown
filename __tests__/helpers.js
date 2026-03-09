/**
 * Test helpers for vue-markdown
 *
 * Consolidates reusable fast-check generators and VNode tree utilities
 * used across property tests and unit tests.
 */

import fc from 'fast-check'
import {createProcessor, createFile} from '../lib/index.js'

// ============================================================
// fast-check custom generators
// ============================================================

/**
 * Generates various Markdown strings covering common syntax:
 * headings, bold, italic, links, lists, blockquotes, code.
 */
export function markdownArb() {
  return fc.oneof(
    fc.constant('# Hello World'),
    fc.constant('## Second Heading'),
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
}

/**
 * Generates URLs with various protocols — both safe and unsafe.
 */
export function urlArb() {
  const safeProtocols = ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp']
  const unsafeProtocols = ['javascript', 'data', 'vbscript', 'file', 'ftp', 'blob']

  return fc.oneof(
    // Safe protocol URLs
    fc.tuple(
      fc.constantFrom(...safeProtocols),
      fc.webPath()
    ).map(([proto, path]) => `${proto}:${path}`),
    // Unsafe protocol URLs
    fc.tuple(
      fc.constantFrom(...unsafeProtocols),
      fc.string({minLength: 0, maxLength: 50})
    ).map(([proto, suffix]) => `${proto}:${suffix}`),
    // Relative URLs
    fc.oneof(
      fc.webPath(),
      fc.constant('/relative/path'),
      fc.constant('#fragment'),
      fc.constant('?query=1')
    )
  )
}


/**
 * Generates component mapping objects: tag name → string tag name.
 * E.g. { p: 'div', strong: 'span' }
 */
export function componentMapArb() {
  const tagPairs = [
    ['p', 'div'],
    ['strong', 'span'],
    ['em', 'i'],
    ['h1', 'div'],
    ['blockquote', 'section'],
    ['a', 'span'],
    ['ul', 'div'],
    ['li', 'div'],
    ['code', 'pre']
  ]

  return fc.subarray(tagPairs, {minLength: 1}).map(pairs => {
    const map = {}
    for (const [from, to] of pairs) {
      map[from] = to
    }
    return map
  })
}

/**
 * Generates arrays of HTML tag names for allowedElements/disallowedElements.
 */
export function elementFilterArb() {
  const allTags = [
    'p', 'strong', 'em', 'a', 'h1', 'h2', 'h3',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'img', 'hr', 'br', 'div', 'span', 'table',
    'thead', 'tbody', 'tr', 'th', 'td'
  ]
  return fc.subarray(allTags, {minLength: 1})
}

// ============================================================
// Test helper functions
// ============================================================

/**
 * Creates a HAST tree from a markdown string using createProcessor + createFile.
 * @param {string} md - Markdown source text
 * @returns {import('hast').Root} HAST root node
 */
export function buildHast(md) {
  const processor = createProcessor({})
  const file = createFile({children: md})
  return processor.runSync(processor.parse(file), file)
}

/**
 * Recursively collects all element tag names from a VNode tree.
 * Skips Vue Fragment symbols.
 * @param {import('vue').VNode} vnode
 * @returns {Set<string>}
 */
export function collectTags(vnode) {
  const tags = new Set()
  function walk(node) {
    if (!node) return
    if (typeof node === 'string') return
    if (
      typeof node.type === 'string' &&
      node.type !== Symbol.for('v-fgt') &&
      node.type !== 'Symbol(v-fgt)'
    ) {
      tags.add(node.type)
    }
    const children = node.children ?? node.props?.children
    if (Array.isArray(children)) children.forEach(walk)
    else if (children && typeof children === 'object') walk(children)
  }
  walk(vnode)
  return tags
}

/**
 * Recursively collects all text content from a VNode tree.
 * @param {import('vue').VNode} vnode
 * @returns {string}
 */
export function collectTextContent(vnode) {
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

/**
 * Recursively collects all href attributes from a VNode tree.
 * @param {import('vue').VNode} vnode
 * @returns {string[]}
 */
export function collectHrefs(vnode) {
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
