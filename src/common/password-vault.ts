import { Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'crypto';

/**
 * เก็บ "รหัสที่ระบบออกให้" แบบเข้ารหัส (AES-256-GCM) เพื่อให้ admin เปิดดูได้ตามสิทธิ์
 * key = env PASSWORD_ENC_KEY (ข้อความสุ่มยาว ≥ 32 ตัว) — ไม่ตั้ง = ไม่เก็บ (ดูรหัสย้อนหลังไม่ได้ แต่ระบบทำงานปกติ)
 * รหัสที่ลูกค้าตั้งเอง ไม่เก็บ (เก็บแค่ bcrypt)
 * ⚠️ เปลี่ยน key แล้ว รหัสที่เก็บไว้เดิมจะถอดไม่ได้ (ต้อง reset ใหม่)
 */
const log = new Logger('PasswordVault');
let warned = false;

function key(): Buffer | null {
    const raw = process.env.PASSWORD_ENC_KEY;
    if (!raw || raw.length < 32) {
        if (!warned) {
            log.warn('PASSWORD_ENC_KEY ไม่ได้ตั้ง (หรือสั้นกว่า 32 ตัว) — จะไม่เก็บรหัสให้ admin ดูย้อนหลัง');
            warned = true;
        }
        return null;
    }
    return createHash('sha256').update(raw).digest();
}

export const passwordVault = {
    enabled: () => key() !== null,

    encrypt(plain: string): string | null {
        const k = key();
        if (!k) return null;
        const iv = randomBytes(12);
        const c = createCipheriv('aes-256-gcm', k, iv);
        const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
        return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
    },

    decrypt(stored: string | null | undefined): string | null {
        const k = key();
        if (!k || !stored) return null;
        const [v, iv, tag, ct] = stored.split(':');
        if (v !== 'v1' || !iv || !tag || !ct) return null;
        try {
            const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
            d.setAuthTag(Buffer.from(tag, 'base64'));
            return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
        } catch {
            return null; // key เปลี่ยน / ข้อมูลเสีย
        }
    },
};

// ไม่มีตัวที่สับสนกันง่าย (0/O, 1/l/I)
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function generatePassword(len = 8) {
    let s = '';
    for (let i = 0; i < len; i++) s += PW_CHARS[randomInt(PW_CHARS.length)];
    return s;
}