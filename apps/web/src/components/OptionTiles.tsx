import { OPTION_KEYS, type OptionKey } from '@uqa/shared';

const SHAPES: Record<OptionKey, string> = { A: '▲', B: '◆', C: '●', D: '■' };

export function OptionTiles({ options, correct, distribution, selected, onPick, disabled, mode }: {
  options: Record<OptionKey, string>;
  correct?: OptionKey | null;
  distribution?: Record<OptionKey, number> | null;
  selected?: OptionKey | null;
  onPick?: (k: OptionKey) => void;
  disabled?: boolean;
  mode: 'stage' | 'phone';
}) {
  const total = distribution ? Object.values(distribution).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className={`tiles tiles-${mode}${correct ? ' revealed' : ''}`}>
      {OPTION_KEYS.map((k) => {
        const isCorrect = correct === k;
        const cls = ['tile', `tile-${k}`, isCorrect ? 'is-correct' : '', correct && !isCorrect ? 'is-dim' : '', selected === k ? 'is-selected' : ''].join(' ');
        const count = distribution?.[k] ?? 0;
        const inner = (
          <>
            <span className="tile-key" aria-hidden>{SHAPES[k]}</span>
            <span className="tile-letter">{k}</span>
            <span className="tile-text">{options[k]}</span>
            {distribution && <span className="tile-bar" aria-hidden style={{ width: total ? `${(count / total) * 100}%` : 0 }} />}
            {isCorrect && <span className="tile-check" aria-label="正確答案">✓</span>}
            {distribution && <b className="tile-count" aria-label={`${count} 人選擇`}>{count}</b>}
          </>
        );
        return onPick ? (
          <button key={k} type="button" className={cls} disabled={disabled} onClick={() => onPick(k)} aria-pressed={selected === k}>{inner}</button>
        ) : <div key={k} className={cls}>{inner}</div>;
      })}
    </div>
  );
}
