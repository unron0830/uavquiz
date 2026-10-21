import { describe, expect, it } from 'vitest';
import { formatExplanation } from '../apps/web/src/lib/explanation-format';

describe('詳解答案關鍵字', () => {
  it('標出答案片語並保留解說其餘內容', () => {
    expect(formatExplanation('答案為協調員，負責空域協調。', '協調員。')).toBe('<p>答案為<strong class="ex-answer-keyword">協調員</strong>，負責空域協調。</p>');
  });
  it('允許答案數字及單位間有空白', () => {
    expect(formatExplanation('應於15 日前提出。', '15日前。')).toContain('>15 日前</strong>');
  });
  it('把括號與小數點當作字面內容，不當作正規表示式', () => {
    const result = formatExplanation('1.5公斤(含)；1X5公斤。', '1.5公斤(含)。');
    expect(result).toContain('>1.5公斤(含)</strong>');
    expect(result).toContain('；1X5公斤。');
  });
  it('保留粗體與清單，且不會替換產生的HTML標籤', () => {
    const result = formatExplanation('- **協調員**提供資訊。', '協調員。');
    expect(result).toBe('<li><strong><strong class="ex-answer-keyword">協調員</strong></strong>提供資訊。</li>');
    expect(formatExplanation('**說明**', 'strong')).toBe('<p><strong>說明</strong></p>');
  });
  it('答案及詳解中的HTML維持純文字，不允許執行腳本', () => {
    const result = formatExplanation('<script>alert(1)</script>', '<script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
  it('無匹配內容時保留原文，不把所有數字都當答案', () => {
    expect(formatExplanation('依第15條規定，提前30日申請。', '15日前。')).not.toContain('ex-answer-keyword');
  });
});
