import { describe, it, expect } from 'vitest';
import {
  todayInZone,
  workState,
  weekStart,
  addDays,
  addMonths,
  monthEnd,
  monthStart,
  taskRisk,
  taskAttentionSections,
  daysBetweenBusinessDates,
} from './rules';
describe('业务日期和互斥工作状态', () => {
  it('不受浏览器本地时区影响，跨年周从周一开始', () => {
    const instant = new Date('2026-12-31T17:00:00Z');
    expect(todayInZone('Asia/Shanghai', instant)).toBe('2027-01-01');
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-12-31');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(addDays(weekStart('2027-01-01'), 6)).toBe('2027-01-03');
  });
  it('未开始、协作与待验收混合时状态互斥', () => {
    expect(workState([])).toBe('idle');
    expect(workState(['todo'])).toBe('assigned');
    expect(workState(['pending_review', 'todo'])).toBe('assigned');
    expect(workState(['pending_review'])).toBe('review');
    expect(workState(['pending_review', 'in_progress'])).toBe('working');
  });
  it('月视图跨年和二月边界正确', () => {
    expect(monthStart('2027-01-31')).toBe('2027-01-01');
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
  });
  it('按工作台业务日期计算风险，人工标记与日期风险并存', () => {
    expect(daysBetweenBusinessDates('2026-12-31', '2027-01-02')).toBe(2);
    expect(taskRisk({ status: 'todo', deadline: '2027-01-01' }, '2026-12-31')).toMatchObject({
      codes: ['due_soon'],
      overdueDays: 0,
      rank: 3,
    });
    expect(
      taskRisk({ status: 'pending_review', deadline: '2026-12-30', risk_flag: 1 }, '2026-12-31'),
    ).toMatchObject({
      codes: ['pending_overdue', 'manual_delay', 'pending_review'],
      overdueDays: 1,
      rank: 0,
    });
    expect(
      taskRisk({ status: 'completed', deadline: '2026-12-01', risk_flag: 1 }, '2026-12-31')
        .isAttention,
    ).toBe(false);
    expect(
      taskRisk({ status: 'todo', deadline: '2026-12-01', deleted_at: '2026-12-02' }, '2026-12-31')
        .isAttention,
    ).toBe(false);
  });
  it('三天提醒按自然日覆盖 +1 至 +3，两端包含且跨年正确', () => {
    const today = '2026-12-31';
    for (const [offset, expected] of [
      [-1, { today: true, upcoming: false, all: true }],
      [0, { today: true, upcoming: false, all: true }],
      [1, { today: false, upcoming: true, all: true }],
      [2, { today: false, upcoming: true, all: true }],
      [3, { today: false, upcoming: true, all: true }],
      [4, { today: false, upcoming: false, all: false }],
    ] as const) {
      const task = { status: 'todo' as const, deadline: addDays(today, offset) };
      expect(taskAttentionSections(task, today)).toEqual(expected);
      expect(taskRisk(task, today).codes.includes('due_soon')).toBe(expected.upcoming);
    }
    expect(taskAttentionSections({ status: 'todo', deadline: '2027-01-03' }, today).upcoming).toBe(
      true,
    );
  });
  it('人工延期和待确认可同时出现在今天区与未来区，完成删除立即退出', () => {
    const deadline = '2026-10-01';
    const today = '2026-09-28';
    expect(taskAttentionSections({ status: 'todo', deadline, risk_flag: 1 }, today)).toEqual({
      today: true,
      upcoming: true,
      all: true,
    });
    expect(taskAttentionSections({ status: 'pending_review', deadline }, today)).toEqual({
      today: true,
      upcoming: true,
      all: true,
    });
    expect(taskAttentionSections({ status: 'completed', deadline, risk_flag: 1 }, today).all).toBe(
      false,
    );
    expect(
      taskAttentionSections({ status: 'todo', deadline, deleted_at: '2026-09-28' }, today).all,
    ).toBe(false);
    expect(taskAttentionSections({ status: 'todo', deadline }, '2026-10-01')).toEqual({
      today: true,
      upcoming: false,
      all: true,
    });
  });
});
