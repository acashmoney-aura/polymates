import { useState, type ReactNode } from 'react'
import { US_STATES, US_VIEWBOX } from '../data/us-states'
import { WORLD_COUNTRIES, WORLD_VIEWBOX } from '../data/world'

/** Northeastern states too small to click on the map; Polymarket lists them as a column of boxes. */
export const SMALL_STATES = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD']

interface Tip { x: number; y: number; content: ReactNode }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const move = (content: ReactNode) => (e: React.MouseEvent) => {
    const box = (e.currentTarget as Element).closest('.emap')!.getBoundingClientRect()
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content })
  }
  const el = tip && (
    <div className="emap-tip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>
  )
  return { move, clear: () => setTip(null), el }
}

export function UsMap({ fill, tooltip, onPick, selected }: {
  fill: (state: string) => string | null
  tooltip: (state: string) => ReactNode
  onPick: (state: string) => void
  selected?: string | null
}) {
  const tip = useTip()
  return (
    <div className="emap us-map">
      <svg viewBox={US_VIEWBOX} role="img" aria-label="Map of US states">
        {US_STATES.map((s) => {
          const color = fill(s.id)
          return (
            <path key={s.id} d={s.d} className={`st ${color ? 'has' : ''} ${selected === s.id ? 'sel' : ''}`}
              style={color ? { fill: color } : undefined}
              onClick={color ? () => onPick(s.id) : undefined}
              onMouseMove={tip.move(tooltip(s.id))} onMouseLeave={tip.clear}>
              <title>{s.name}</title>
            </path>
          )
        })}
        {US_STATES.filter((s) => !SMALL_STATES.includes(s.id) && !['HI', 'DC'].includes(s.id)).map((s) => (
          <text key={s.id} x={s.cx} y={s.cy} className={`st-label ${fill(s.id) ? '' : 'dim'}`}>{s.id}</text>
        ))}
      </svg>
      <div className="small-states">
        {SMALL_STATES.map((id) => {
          const color = fill(id)
          return (
            <button key={id} className={`ss ${color ? 'has' : ''} ${selected === id ? 'sel' : ''}`} disabled={!color}
              style={color ? { background: color } : undefined} onClick={() => onPick(id)}
              onMouseMove={tip.move(tooltip(id))} onMouseLeave={tip.clear}>{id}</button>
          )
        })}
      </div>
      {tip.el}
    </div>
  )
}

export function WorldMap({ fill, tooltip, onPick, selected }: {
  fill: (mapName: string) => string | null
  tooltip: (mapName: string) => ReactNode
  onPick: (mapName: string) => void
  selected?: string | null
}) {
  const tip = useTip()
  return (
    <div className="emap world-map">
      <svg viewBox={WORLD_VIEWBOX} role="img" aria-label="World map of upcoming elections">
        {WORLD_COUNTRIES.map((c) => {
          const color = fill(c.name)
          return (
            <path key={c.name} d={c.d} className={`ct ${color ? 'has' : ''} ${selected === c.name ? 'sel' : ''}`}
              style={color ? { fill: color } : undefined}
              onClick={color ? () => onPick(c.name) : undefined}
              onMouseMove={color ? tip.move(tooltip(c.name)) : undefined} onMouseLeave={tip.clear} />
          )
        })}
      </svg>
      {tip.el}
    </div>
  )
}
