import { AppError } from '../common/app-error';
import { Tier } from './mappers';

const TIER_BY_STAKES: Record<string, Tier> = {
  '1/2': 'bronze', '2/4': 'bronze',
  '5/10': 'silver', '10/20': 'silver',
  '20/40': 'gold', '50/100': 'gold',
};

/**
 * Columns: xpoker_id, stakes, hands, where hands is the total since the event began.
 * A player's rows of one level are added up, and importing the same file again sets the same numbers.
 * ponytail: assumed columns and a plain comma split; replace once there is a sample of the real X-Poker report.
 */
export function parseHandsReport(csv: string) {
  const [head = '', ...lines] = csv.replace(/^﻿/, '').split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim().toLowerCase());
  const [idAt, stakesAt, handsAt] = ['xpoker_id', 'stakes', 'hands'].map((c) => cols.indexOf(c));
  if (idAt < 0 || stakesAt < 0 || handsAt < 0) throw new AppError(400, 'REPORT_BAD_HEADER');

  const totals = new Map<string, { xpokerId: string; tier: Tier; hands: number }>();
  const skipped: number[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cells = line.split(',').map((c) => c.trim());
    const xpokerId = cells[idAt];
    const tier = TIER_BY_STAKES[cells[stakesAt]];
    if (!xpokerId || !tier || !/^\d{1,9}$/.test(cells[handsAt] ?? '')) {
      skipped.push(i + 2); // line number in the file, counting the header
      return;
    }
    const key = `${xpokerId}|${tier}`;
    const row = totals.get(key) ?? { xpokerId, tier, hands: 0 };
    row.hands += Number(cells[handsAt]);
    totals.set(key, row);
  });
  return { rows: [...totals.values()], skipped };
}
