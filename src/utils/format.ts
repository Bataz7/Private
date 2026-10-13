export function discordDate(date: Date, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f') {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

export function parseDateInput(input: string) {
  const value = input.trim();
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error('التاريخ غير صحيح. اكتبه بصيغة سنة-شهر-يوم.');
  return date;
}
