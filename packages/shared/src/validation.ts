import type { OptionKey } from './types.ts';

export interface QuestionInput {
  question_id: string;
  course_no: number | null;
  topic: string;
  round_no: number | null;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionKey;
  answer_explanation: string;
  explanation_verified?: boolean;
  law_reference: string;
  law_excerpt: string;
  law_url: string;
  reference_urls: string;
  explanation_images: string;
  source_name: string;
  source_url: string;
  source_version: string;
  source_question_no: string;
  time_limit_seconds: number | null;
  active: boolean;
}

export const CSV_COLUMNS = [
  'question_id', 'course_no', 'topic', 'round_no', 'stem', 'option_a', 'option_b', 'option_c', 'option_d',
  'correct_option', 'answer_explanation', 'explanation_verified', 'law_reference', 'law_excerpt', 'law_url', 'reference_urls',
  'explanation_images', 'source_name', 'source_url', 'source_version', 'source_question_no', 'time_limit_seconds', 'active',
] as const;

export interface RowError { row: number; field: string; message: string }

const isHttps = (s: string) => /^https:\/\/[^\s]+$/i.test(s);

/** 驗證一列題目（SPEC §6.2），回傳正規化結果與錯誤 */
export function validateQuestionRow(
  raw: Record<string, string>,
  rowNo: number,
  limits = { min: 5, max: 120 },
): { value?: QuestionInput; errors: RowError[] } {
  const errors: RowError[] = [];
  const g = (k: string) => (raw[k] ?? '').toString().trim();
  const err = (field: string, message: string) => errors.push({ row: rowNo, field, message });

  const id = g('question_id');
  if (!id) err('question_id', '題目 ID 不可空白');
  else if (id.length > 64 || !/^[\w\-.]+$/.test(id)) err('question_id', '題目 ID 只能用英數字、-、_、.，最長 64 字');

  const courseRaw = g('course_no');
  let course: number | null = null;
  if (courseRaw) {
    course = Number(courseRaw);
    if (!Number.isInteger(course) || course < 1 || course > 4) err('course_no', 'course_no 只能是 1–4');
  }
  const roundRaw = g('round_no');
  let round: number | null = null;
  if (roundRaw) {
    round = Number(roundRaw);
    if (!Number.isInteger(round) || round < 1 || round > 9) err('round_no', 'round_no 須為 1–9');
  }
  const stem = g('stem');
  if (!stem) err('stem', '題幹不可空白');
  for (const k of ['option_a', 'option_b', 'option_c', 'option_d']) if (!g(k)) err(k, '選項不可空白');

  const ans = g('correct_option').toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(ans)) err('correct_option', '答案只能是 A/B/C/D');

  if (/[（(]\s*答\s*[:：]?\s*[A-D]\s*[)）]|正確答案\s*[:：]/.test(stem)) err('stem', '題幹含有可能暴露正解的標示');

  const tRaw = g('time_limit_seconds');
  let t: number | null = null;
  if (tRaw) {
    t = Number(tRaw);
    if (!Number.isInteger(t) || t < limits.min || t > limits.max) err('time_limit_seconds', `秒數須為 ${limits.min}–${limits.max} 的整數，或空白沿用預設`);
  }
  const lawUrl = g('law_url');
  if (lawUrl && !isHttps(lawUrl)) err('law_url', '連結只接受 https://');
  const refs = g('reference_urls');
  if (refs) for (const u of refs.split('|').map((s) => s.trim()).filter(Boolean)) if (!isHttps(u)) err('reference_urls', `連結只接受 https://：${u}`);
  const srcUrl = g('source_url');
  if (srcUrl && !isHttps(srcUrl)) err('source_url', '連結只接受 https://');
  const imgs = g('explanation_images');
  if (imgs) for (const f of imgs.split('|').map((s) => s.trim()).filter(Boolean)) if (/[\\/]|\.\./.test(f) || !/\.(png|jpe?g|webp|gif)$/i.test(f)) err('explanation_images', `圖片檔名不合法：${f}`);

  const activeRaw = g('active').toLowerCase();
  const active = activeRaw === '' ? true : ['true', '1', 'yes', 'y', '是'].includes(activeRaw);

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      question_id: id, course_no: course, topic: g('topic'), round_no: round, stem,
      option_a: g('option_a'), option_b: g('option_b'), option_c: g('option_c'), option_d: g('option_d'),
      correct_option: ans as OptionKey, answer_explanation: g('answer_explanation'),
      explanation_verified: g('explanation_verified').toLowerCase() === 'true',
      law_reference: g('law_reference'), law_excerpt: g('law_excerpt'), law_url: lawUrl, reference_urls: refs,
      explanation_images: imgs, source_name: g('source_name'), source_url: srcUrl, source_version: g('source_version'),
      source_question_no: g('source_question_no'), time_limit_seconds: t, active,
    },
  };
}

/** 匯出 CSV 時的公式注入防護 */
export function csvSafe(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 學號、姓名或暱稱：純文字名稱；儲存仍沿用 nickname 欄位。 */
const BAD_WORDS = ['幹你', '靠北', '機掰', '雞掰', '王八', '白痴', '智障', '去死', 'fuck', 'shit', 'bitch'];
export function validateNickname(s: string): string | null {
  if (typeof s !== 'string' || s.length > 256) return '請輸入有效的學號、姓名或暱稱';
  if (/[\p{Cc}\p{Cf}]/u.test(s)) return '名稱不可包含換行、控制字元或隱藏字元';
  const n = s.normalize('NFC').trim().replace(/ +/g, ' ');
  const len = [...n].length;
  if (len < 2 || len > 32) return '學號、姓名或暱稱需 2–32 字';
  if (!/^[\p{L}\p{M}\p{N} ._'’·()\-]+$/u.test(n)) return '名稱僅接受文字、數字、空格與 . _ - 單引號、間隔號或括號';
  if (BAD_WORDS.some(w => n.toLowerCase().includes(w))) return '名稱含有不當用語';
  return null;
}
