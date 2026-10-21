import { useEffect, useState } from 'react';
import type { Explanation as Ex } from '@uqa/shared';
import { assetUrl } from '../lib/base';
import { formatExplanation } from '../lib/explanation-format';

export function ExplanationPanel({ ex, adhoc, showText = true, answerText = '' }: { ex: Ex; adhoc?: { kind: 'image' | 'url'; value: string } | null; showText?: boolean; answerText?: string }) {
  const [img, setImg] = useState(0);
  const [zoom, setZoom] = useState(false);
  const contentKey = JSON.stringify([ex.text, ex.lawReference, ex.lawExcerpt, ex.images]);
  useEffect(() => { setImg(0); setZoom(false); }, [contentKey]);
  const normalize = (text: string) => text.replace(/[\s，。；：、（）()「」『』【】]/g, '');
  const text = showText ? ex.text : '';
  const lawText = showText && ex.lawExcerpt && !normalize(text).includes(normalize(ex.lawExcerpt)) ? ex.lawExcerpt : '';
  const lawTitle = showText && ex.lawReference && !normalize(text + lawText).includes(normalize(ex.lawReference)) ? ex.lawReference : '';
  const hasText = !!(text || lawText || lawTitle);
  if (adhoc?.kind === 'image') return <div className="ex ex-adhoc"><img src={assetUrl(adhoc.value)} alt="講解圖片" /></div>;
  if (adhoc?.kind === 'url') return <div className="ex ex-adhoc"><p className="ex-url">老師正在講解：<br /><b>{adhoc.value}</b></p></div>;
  if (!hasText && !ex.images.length) return null;
  return (
    <div className="ex">
      {hasText && <section className="ex-text"><h4>解說</h4>{answerText && <p><b>正確答案：</b><strong className="ex-answer-keyword">{answerText}</strong></p>}{text && <div dangerouslySetInnerHTML={{ __html: formatExplanation(text, answerText) }} />}{lawTitle && <p className="ex-source"><b>依據：</b>{lawTitle}</p>}{lawText && <div dangerouslySetInnerHTML={{ __html: formatExplanation(lawText, answerText) }} />}</section>}
      {ex.images.length > 0 && (
        <div className={`ex-images${zoom ? ' zoom' : ''}`}>
          <h4>圖片（{ex.images.length}）</h4>
          <img src={assetUrl(ex.images[img] ?? ex.images[0])} alt={`講解圖片 ${img + 1}`} onClick={() => setZoom(!zoom)} />
          {ex.images.length > 1 && (
            <div className="ex-nav">
              <button onClick={() => setImg((img - 1 + ex.images.length) % ex.images.length)} aria-label="上一張">‹</button>
              <span>{img + 1} / {ex.images.length}</span>
              <button onClick={() => setImg((img + 1) % ex.images.length)} aria-label="下一張">›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
