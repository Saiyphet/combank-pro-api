/**
 * Supabase ตัดผลที่ 1000 แถวต่อ request — ดึงทีละหน้าจนครบ
 * ใช้: fetchAll((from, to) => db.from('x').select('*').order('id').range(from, to))
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}
