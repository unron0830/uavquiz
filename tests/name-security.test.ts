import { describe, expect, it } from 'vitest';
import { csvSafe, validateNickname, rankIndividuals } from '@uqa/shared';

describe('參賽名稱輸入', () => {
  it.each(['0012345678', 'S123456789', '王小明', '飛行小王子', "O'Connor", 'Jean-Luc', '測試者 1', '𠀀文', 'Jose\u0301'])('接受學號或純文字名稱 %s', name => {
    expect(validateNickname(name)).toBeNull();
  });
  it.each(["' OR '1'='1", "Robert'); DROP TABLE users;--", '<script>alert(1)</script>', '=1+1', '@SUM(A1)', '../config.json', '小明\n王', '小\u0000明', '小\u202e明', 'a'.repeat(33), ''])('拒絕不符合名稱格式的內容 %s', name => {
    expect(validateNickname(name)).toBeTruthy();
  });
  it('合法 SQL 關鍵字只是文字，不用關鍵字黑名單誤擋姓名', () => {
    expect(validateNickname('Select')).toBeNull();
    expect(validateNickname('Drop Table')).toBeNull();
  });
  it.each(['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '\t=1+1'])('保留匯出 CSV 的公式防護 %s', value => {
    expect(csvSafe(value)).toContain("'");
  });
  it('速度分數較高者排前，同分再比正確題數與有效耗時', () => {
    const people = [1, 2].map(id => ({ id, teamId: null, joinOrder: id, lateJoin: false, removed: false }));
    const rows = rankIndividuals(people, [
      { participantId: 1, questionId: 'Q1', option: 'A', correct: true, elapsedMs: 5000, points: 1250 },
      { participantId: 2, questionId: 'Q1', option: 'A', correct: true, elapsedMs: 1000, points: 1450 },
    ], new Set(['Q1']));
    expect(rows[0]).toMatchObject({ participantId: 2, points: 1450, rank: 1 });
  });
});
