/**
 * Page extraction, injected into the inspected tab by the side panel.
 *
 * Two capabilities, in one injected file so the panel needs one round trip:
 *
 *   readPage()  — structure-preserving reading-mode extraction. Scores
 *                 candidate containers the way reading modes do (text
 *                 density over link density), then walks that subtree into
 *                 Markdown, so headings, tables, code, lists, and links
 *                 survive as structure instead of collapsing into one
 *                 paragraph the way innerText does.
 *
 *   readSiteData() — structured data for pages whose numbers never reach the
 *                 DOM (a chart's series, a quote feed). This file ships NO
 *                 site knowledge: adapters live in the user's own
 *                 `site-adapters.json`, matched by hostname, and this engine
 *                 only executes what they declare. Without a matching
 *                 adapter the panel sends the reading-mode result alone.
 *
 * Everything here runs in the page's own world under chrome.scripting, so
 * it may only use what the page provides; the file is loaded as a plain
 * script (no modules, no bundler).
 */

/** Blocks that never belong to an article body. */
const STRIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'FORM',
  'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
])

/** Class/id fragments that mark chrome rather than content. */
const STRIP_HINTS = /(^|[-_ ])(nav|menu|sidebar|footer|header|banner|advert|ads?|promo|share|social|comment|related|recommend|breadcrumb|pagination|toolbar|cookie|popup|modal|subscribe|newsletter)([-_ ]|$)/i

/** Whether an element looks like page furniture rather than body content. */
function isChrome(element) {
  if (STRIP_TAGS.has(element.tagName)) return true
  const marker = `${element.className || ''} ${element.id || ''}`
  if (marker.length > 0 && STRIP_HINTS.test(marker)) return true
  const role = element.getAttribute('role')
  return role === 'navigation' || role === 'banner' || role === 'complementary'
}

/** Visible text length of a node, ignoring whitespace runs. */
function textLength(node) {
  // innerText reflects rendering but is absent in non-layout hosts; textContent is the floor.
  return (node.innerText ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().length
}

/**
 * Score one candidate container: long text wins, but text that is mostly
 * link labels (menus, card grids) loses.
 */
function scoreCandidate(element) {
  const total = textLength(element)
  if (total < 140) return 0
  let linkText = 0
  for (const anchor of element.querySelectorAll('a')) linkText += textLength(anchor)
  const linkDensity = total === 0 ? 1 : linkText / total
  const paragraphs = element.querySelectorAll('p, pre, table, blockquote, li').length
  return total * (1 - Math.min(linkDensity, 0.95)) + paragraphs * 40
}

/** Pick the best article container, preferring explicit semantics. */
function pickArticleRoot() {
  for (const selector of ['article', '[role="main"]', 'main', '.markdown-body', '#readme']) {
    const node = document.querySelector(selector)
    if (node !== null && textLength(node) > 200) return node
  }
  let best = document.body
  let bestScore = scoreCandidate(document.body) * 0.5
  for (const element of document.body.querySelectorAll('div, section, article, td')) {
    if (isChrome(element)) continue
    const score = scoreCandidate(element)
    if (score > bestScore) { best = element; bestScore = score }
  }
  return best
}

/** Collapse inline whitespace and escape Markdown's structural characters. */
function inlineText(node) {
  return (node.textContent || '').replace(/\s+/g, ' ')
}

/** Render one table as a Markdown table, keeping the column relation. */
function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('th, td')].map(cell => inlineText(cell).trim().replace(/\|/g, '\\|')))
    .filter(cells => cells.length > 0)
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map(cells => cells.length))
  const pad = cells => [...cells, ...Array(width - cells.length).fill('')]
  const [head, ...body] = rows
  const lines = [`| ${pad(head).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`]
  for (const cells of body) lines.push(`| ${pad(cells).join(' | ')} |`)
  return `${lines.join('\n')}\n\n`
}

/** Walk one subtree into Markdown, preserving block semantics. */
function toMarkdown(root) {
  const out = []
  const walk = (node, listDepth) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ')
      if (text.trim().length > 0) out.push(text)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node
    if (isChrome(element)) return
    // Skip anything the page itself hides.
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (style !== undefined && (style.display === 'none' || style.visibility === 'hidden')) return

    switch (element.tagName) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const level = Number(element.tagName[1])
        out.push(`\n\n${'#'.repeat(level)} ${inlineText(element).trim()}\n\n`)
        return
      }
      case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'MAIN': {
        out.push('\n\n')
        for (const child of element.childNodes) walk(child, listDepth)
        out.push('\n\n')
        return
      }
      case 'BR': out.push('\n'); return
      case 'HR': out.push('\n\n---\n\n'); return
      case 'STRONG': case 'B': out.push(`**${inlineText(element).trim()}**`); return
      case 'EM': case 'I': out.push(`*${inlineText(element).trim()}*`); return
      case 'CODE': {
        if (element.closest('pre') !== null) { out.push(inlineText(element)); return }
        out.push(`\`${inlineText(element).trim()}\``)
        return
      }
      case 'PRE': {
        const language = (element.querySelector('code')?.className || '').match(/language-([\w+-]+)/)
        out.push(`\n\n\`\`\`${language === null ? '' : language[1]}\n${(element.textContent || '').replace(/\n+$/, '')}\n\`\`\`\n\n`)
        return
      }
      case 'BLOCKQUOTE': {
        const inner = inlineText(element).trim()
        out.push(`\n\n${inner.split('\n').map(line => `> ${line}`).join('\n')}\n\n`)
        return
      }
      case 'UL': case 'OL': {
        out.push('\n')
        let index = 1
        for (const item of element.children) {
          if (item.tagName !== 'LI') continue
          const bullet = element.tagName === 'OL' ? `${index++}.` : '-'
          out.push(`\n${'  '.repeat(listDepth)}${bullet} `)
          for (const child of item.childNodes) walk(child, listDepth + 1)
        }
        out.push('\n\n')
        return
      }
      case 'TABLE': out.push(`\n\n${tableToMarkdown(element)}`); return
      case 'A': {
        const label = inlineText(element).trim()
        const href = element.getAttribute('href') || ''
        if (label.length === 0) return
        out.push(href.length === 0 || href.startsWith('javascript:') ? label : `[${label}](${href})`)
        return
      }
      case 'IMG': {
        // Keep the address, not the bytes: an article can carry a dozen
        // images, and the agent can fetch the ones it actually needs.
        // `currentSrc` resolves srcset/lazy-loading to what is on screen.
        const alt = (element.getAttribute('alt') || '').trim()
        const src = element.currentSrc || element.getAttribute('src') || ''
        if (src.length === 0 || src.startsWith('data:')) {
          if (alt.length > 0) out.push(`![${alt}]`)
          return
        }
        out.push(`![${alt}](${new URL(src, location.href).href})`)
        return
      }
      default:
        for (const child of element.childNodes) walk(child, listDepth)
    }
  }
  walk(root, 0)
  return out.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract the page as Markdown plus the user's current selection.
 * @returns the reading-mode result.
 */
function readPage() {
  const selection = String(window.getSelection() ?? '').trim()
  const root = pickArticleRoot()
  return {
    url: location.href,
    title: document.title,
    selection,
    markdown: toMarkdown(root),
  }
}

// ---- Configured site adapters ----
// The panel passes the user's adapter list in; this file knows no sites.

/** Resolve one `{ from, pattern, group }` capture against the page. */
function captureValue(rule) {
  if (rule === undefined || rule === null) return undefined
  if (typeof rule === 'string') return rule
  const source = rule.from === 'title' ? document.title
    : rule.from === 'hostname' ? location.hostname
      : rule.from === 'selector' ? (document.querySelector(rule.selector)?.textContent || '').trim()
        : location.href
  if (rule.pattern === undefined) return source
  const match = new RegExp(rule.pattern).exec(source)
  return match === null ? undefined : (match[rule.group ?? 1] ?? undefined)
}

/** Fill `{name}` placeholders in a template from resolved captures. */
function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    values[key] === undefined ? whole : encodeURIComponent(values[key]))
}

/**
 * Run the first adapter whose hostname pattern matches this page.
 * @param adapters - the user's configured adapter list.
 * @returns the adapter's structured payload, or undefined when none matched.
 */
async function readSiteData(adapters) {
  if (!Array.isArray(adapters)) return undefined
  const adapter = adapters.find((candidate) => {
    try {
      return new RegExp(candidate.match).test(location.hostname)
    } catch {
      return false
    }
  })
  if (adapter === undefined) return undefined

  // Resolve declared captures (symbol, code, period …) from the page.
  const values = {}
  for (const [key, rule] of Object.entries(adapter.capture ?? {})) {
    const value = captureValue(rule)
    if (value === undefined) {
      return { adapter: adapter.name, error: `capture "${key}" did not match on this page` }
    }
    values[key] = value
  }

  if (typeof adapter.request !== 'string') {
    return { adapter: adapter.name, values }
  }
  const url = fillTemplate(adapter.request, values)
  try {
    const response = await fetch(url, { credentials: 'omit' })
    if (!response.ok) return { adapter: adapter.name, error: `${url} returned ${response.status}` }
    const body = await response.text()
    // `extract` names a regex whose first group holds the payload (JSONP and
    // callback wrappers); absent, the body is used as-is.
    const payload = adapter.extract === undefined
      ? body
      : (new RegExp(adapter.extract, 's').exec(body)?.[1] ?? body)
    let data
    try {
      data = JSON.parse(payload)
    } catch {
      data = payload.slice(0, 20000)
    }
    return { adapter: adapter.name, values, url, data }
  } catch (error) {
    return { adapter: adapter.name, error: String(error) }
  }
}
