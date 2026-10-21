import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** 在瀏覽器產生 QR Code（SVG） */
export function Qr({ text, className, dark = '#23143D' }: { text: string; className?: string; dark?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let ok = true;
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark, light: '#FFFFFF' } }).then((s) => ok && setSvg(s)).catch(() => setSvg(''));
    return () => { ok = false; };
  }, [text, dark]);
  return <div className={className} role="img" aria-label={`QR Code：${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
