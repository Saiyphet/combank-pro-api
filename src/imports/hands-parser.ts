import * as ExcelJS from 'exceljs';

/**
 * อ่านไฟล์ .xlsx ที่ 1 หน้า = 1 โต๊ะ (ชื่อหน้า "1-2", "2-4" … ใช้ "/" ก็ได้ถ้าเป็น Google Sheet)
 * หัวคอลัมน์ (แถวแรกที่มี xpoker_id): xpoker_id | name | hands  — คอลัมน์อื่นไม่อ่าน
 * hands = ยอดสะสม (ตามที่ LD โชว์)
 */

export interface StakeRef {
    id: string;
    code: string; // "1/2"
    wheelCode: string;
    handsPerSpin: number;
}

export interface ParsedEntry {
    sheet: string;
    row: number;
    stake: StakeRef;
    xpokerPlayerId: string;
    name: string | null;
    hands: number;
}

export interface ImportIssue {
    sheet?: string;
    row?: number;
    column?: string;
    code: string;
    message: string;
    value?: string | number | null;
    xpokerPlayerId?: string;
}

const MAX_ROWS = 50_000;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const STAKE_LIKE = /^\d+\/\d+$/;

export function normalizeSheetName(name: string) {
    return name.trim().replace(/\s+/g, '').replace(/[-_]/g, '/').toLowerCase();
}

function cellText(v: ExcelJS.CellValue): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'boolean') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
        if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
        if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
        if ('text' in v) return String((v as { text: unknown }).text).trim();
    }
    return String(v).trim();
}

export async function parseHandsWorkbook(buffer: Buffer, stakes: StakeRef[]) {
    const wb = new ExcelJS.Workbook();
    const errors: ImportIssue[] = [];
    try {
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
        return {
            entries: [] as ParsedEntry[],
            errors: [{ code: 'FILE_NOT_XLSX', message: 'อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx (Excel / Google Sheet → Download → .xlsx)' }],
            sheets: [] as string[],
            ignoredSheets: [] as string[],
        };
    }

    const byName = new Map(stakes.map((s) => [s.code.toLowerCase(), s]));
    const entries: ParsedEntry[] = [];
    const sheets: string[] = [];
    const ignoredSheets: string[] = [];
    let total = 0;

    for (const ws of wb.worksheets) {
        const norm = normalizeSheetName(ws.name);
        const stake = byName.get(norm);
        if (!stake) {
            if (STAKE_LIKE.test(norm)) {
                errors.push({ sheet: ws.name, code: 'UNKNOWN_STAKE_SHEET', message: `หน้า "${ws.name}" ไม่ใช่โต๊ะของโปรนี้` });
            } else {
                ignoredSheets.push(ws.name);
            }
            continue;
        }
        sheets.push(ws.name);

        // หาแถวหัวคอลัมน์ (ภายใน 5 แถวแรก)
        let headerRow = 0;
        const col: Record<string, number> = {};
        for (let r = 1; r <= Math.min(5, ws.rowCount || 1) && !headerRow; r++) {
            const row = ws.getRow(r);
            const found: Record<string, number> = {};
            row.eachCell({ includeEmpty: false }, (cell, c) => {
                const h = cellText(cell.value).toLowerCase().replace(/[\s-]+/g, '_');
                if (['xpoker_id', 'xpoker_player_id', 'id'].includes(h) && !found.id) found.id = c;
                else if (['name', 'display_name'].includes(h) && !found.name) found.name = c;
                else if (['hands', 'hand'].includes(h) && !found.hands) found.hands = c;
            });
            if (found.id) {
                headerRow = r;
                Object.assign(col, found);
            }
        }
        if (!headerRow || !col.hands) {
            errors.push({
                sheet: ws.name,
                row: headerRow || 1,
                code: 'MISSING_COLUMN',
                message: `หน้า "${ws.name}" ต้องมีหัวคอลัมน์ xpoker_id และ hands`,
            });
            continue;
        }

        const seen = new Map<string, number>();
        for (let r = headerRow + 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const idText = cellText(row.getCell(col.id).value);
            const handsText = cellText(row.getCell(col.hands).value);
            const name = col.name ? cellText(row.getCell(col.name).value) || null : null;
            if (!idText && !handsText) continue; // แถวว่าง
            if (++total > MAX_ROWS) {
                errors.push({ code: 'TOO_MANY_ROWS', message: `ไฟล์มีเกิน ${MAX_ROWS.toLocaleString()} แถว` });
                return { entries, errors, sheets, ignoredSheets };
            }

            const xid = idText.replace(/\.0+$/, '');
            if (!ID_RE.test(xid)) {
                errors.push({ sheet: ws.name, row: r, column: 'xpoker_id', code: 'INVALID_ID', message: 'xpoker_id ต้องเป็นตัวเลข / ตัวอักษร ไม่เกิน 32 ตัว', value: idText || null });
                continue;
            }
            const handsClean = handsText.replace(/[,\s]/g, '').replace(/\.0+$/, '');
            if (!/^\d+$/.test(handsClean) || Number(handsClean) > 10_000_000) {
                errors.push({ sheet: ws.name, row: r, column: 'hands', code: 'INVALID_HANDS', message: 'hands ต้องเป็นตัวเลขเต็ม 0 ขึ้นไป', value: handsText || null, xpokerPlayerId: xid });
                continue;
            }
            const key = xid.toLowerCase();
            if (seen.has(key)) {
                errors.push({ sheet: ws.name, row: r, column: 'xpoker_id', code: 'DUPLICATE_ID', message: `ID ซ้ำกับแถว ${seen.get(key)} ในหน้าเดียวกัน`, value: xid, xpokerPlayerId: xid });
                continue;
            }
            seen.set(key, r);
            entries.push({ sheet: ws.name, row: r, stake, xpokerPlayerId: xid, name, hands: Number(handsClean) });
        }
    }

    if (!sheets.length && !errors.length) {
        errors.push({
            code: 'NO_STAKE_SHEETS',
            message: `ไม่พบหน้าที่ชื่อตรงกับโต๊ะ (${stakes.map((s) => s.code.replace('/', '-')).join(', ')})`,
        });
    }
    return { entries, errors, sheets, ignoredSheets };
}