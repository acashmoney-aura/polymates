import { useRef, type ReactNode } from 'react'
import { Icon } from '../icons'
import { useApp } from '../store'

/**
 * Small dependency-free syntax highlighter for the code we show: strategy scripts (JS), curl/shell
 * snippets and JSON configs. One regex per language with named groups, scanned left to right.
 */

export type Lang = 'js' | 'bash' | 'json' | 'text'

const JS_KEYWORDS = 'async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|switch|throw|try|typeof|var|void|while|yield'
const JS_LITERALS = 'true|false|null|undefined|NaN|Infinity|this'

const RULES: Record<Exclude<Lang, 'text'>, RegExp> = {
  js: new RegExp(
    [
      String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
      String.raw`(?<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\x60(?:\\.|[^\x60\\])*\x60)`,
      String.raw`(?<keyword>\b(?:${JS_KEYWORDS})\b)`,
      String.raw`(?<literal>\b(?:${JS_LITERALS})\b)`,
      String.raw`(?<number>\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)`,
      String.raw`(?<fn>\b[A-Za-z_$][\w$]*(?=\s*\())`,
      String.raw`(?<prop>(?<=\.)[A-Za-z_$][\w$]*)`,
      String.raw`(?<punct>=>|[{}()[\];,.<>+\-*/%=!&|?:])`,
    ].join('|'),
    'g',
  ),
  bash: new RegExp(
    [
      String.raw`(?<comment>(?:^|(?<=\s))#[^\n]*)`,
      String.raw`(?<string>'[^'\n]*'|"(?:\\.|[^"\\\n])*")`,
      String.raw`(?<url>https?:\/\/[^\s"'\\]+)`,
      String.raw`(?<flag>(?<=\s)--?[A-Za-z][\w-]*)`,
      String.raw`(?<cmd>(?:^|(?<=\n))\s*(?:curl|claude|npm|npx|node|git|gcloud|export|GET|POST|PATCH|PUT|DELETE)\b)`,
      String.raw`(?<var>\$\{?[A-Za-z_][\w]*\}?)`,
      String.raw`(?<punct>\\$|[|&;<>])`,
    ].join('|'),
    'gm',
  ),
  json: new RegExp(
    [
      String.raw`(?<prop>"(?:\\.|[^"\\])*"(?=\s*:))`,
      String.raw`(?<string>"(?:\\.|[^"\\])*")`,
      String.raw`(?<number>-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)`,
      String.raw`(?<literal>\b(?:true|false|null)\b)`,
      String.raw`(?<punct>[{}[\],:])`,
    ].join('|'),
    'g',
  ),
}

export function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === 'text') return [code]
  const re = new RegExp(RULES[lang].source, RULES[lang].flags)
  const out: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(re)) {
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0]
    if (!kind || !m[0]) continue
    if (m.index > last) out.push(code.slice(last, m.index))
    out.push(<span key={m.index} className={`tk-${kind}`}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

/** Guess the language of a snippet so call sites don't have to say. */
export function detectLang(code: string): Lang {
  const t = code.trimStart()
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch { /* not json */ }
  }
  if (/^(#|curl|claude|npm|npx|GET |POST |DELETE |export )/m.test(t)) return 'bash'
  if (/^pm_[A-Za-z0-9]/.test(t)) return 'text'
  return 'js'
}

/** Read-only code block with highlighting and a copy button. */
export function CodeBlock({ children, lang }: { children: string; lang?: Lang }) {
  const { toast } = useApp()
  return (
    <div className="codeblock">
      <button className="icon-btn" aria-label="Copy" onClick={() => { void navigator.clipboard?.writeText(children); toast('Copied') }}><Icon name="copy" size={16} /></button>
      <pre className="hl">{highlight(children, lang ?? detectLang(children))}</pre>
    </div>
  )
}

/**
 * Editable code with line numbers and live highlighting: a highlighted <pre> sits under a transparent
 * <textarea> with the same metrics, so typing, selection, undo and IME all stay native.
 */
export function CodeEditor({ value, onChange, onRun, lang = 'js', label = 'Code', className = '' }: {
  value: string; onChange: (v: string) => void; onRun?: () => void; lang?: Lang; label?: string; className?: string
}) {
  const gutter = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLPreElement>(null)
  const lines = value.split('\n').length
  return (
    <div className={`code-editor ${className}`}>
      <div className="gutter" ref={gutter} aria-hidden>{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
      <div className="code-area">
        {/* trailing newline + space keeps the layer as tall as the textarea's last empty line */}
        <pre className="hl code-layer" ref={layer} aria-hidden>{highlight(value, lang)}{'\n '}</pre>
        <textarea spellCheck={false} value={value} aria-label={label} autoCapitalize="off" autoCorrect="off"
          onScroll={(e) => {
            const { scrollTop, scrollLeft } = e.currentTarget
            if (gutter.current) gutter.current.scrollTop = scrollTop
            if (layer.current) { layer.current.scrollTop = scrollTop; layer.current.scrollLeft = scrollLeft }
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onRun) { e.preventDefault(); onRun() }
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.currentTarget, s = t.selectionStart
              onChange(`${value.slice(0, s)}  ${value.slice(t.selectionEnd)}`)
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2 })
            }
          }} />
      </div>
    </div>
  )
}
