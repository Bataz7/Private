import sharp from 'sharp';

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] ?? char));
}

async function imageDataUri(url: string) {
  if (!url) return '';
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    const type = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

export type StaffCardData = {
  name: string; avatar: string; points: number; complaints: number; shiftHours: number; voiceHours: number; messages: number;
  /** People helped (from /assist). Optional so older callers keep working. */
  helped?: number;
  ratingAverage?: number; ratingCount?: number;
};

export async function buildStaffCard(data: StaffCardData) {
  const avatarUri = await imageDataUri(data.avatar);
  const avatarImage = avatarUri ? `<image href="${avatarUri}" x="56" y="54" width="112" height="112" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>` : '';
  const rating = data.ratingCount ? `${(data.ratingAverage ?? 0).toFixed(1)}/5` : '-';
  const svg = `<svg width="900" height="500" viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#241837"/><stop offset=".55" stop-color="#171220"/><stop offset="1" stop-color="#0f1015"/></linearGradient><clipPath id="avatar"><circle cx="112" cy="110" r="56"/></clipPath></defs><rect width="900" height="500" rx="28" fill="url(#bg)"/><path d="M720 0h180v260c-90-26-146-86-180-170Z" fill="#9474ff" opacity=".17"/><circle cx="112" cy="110" r="62" fill="#17161f" stroke="#9474ff" stroke-width="5"/>${avatarImage}<text x="210" y="96" fill="#b8a7ff" font-family="Arial" font-size="20" font-weight="700">RIFT STAFF REPORT</text><text x="210" y="143" fill="#fff" font-family="Arial" font-size="36" font-weight="700">${escapeXml(data.name)}</text><text x="210" y="174" fill="#c7bfd4" font-family="Arial" font-size="17">Private activity snapshot</text><rect x="50" y="220" width="800" height="210" rx="18" fill="#111218" stroke="#44335d"/><g font-family="Arial"><text x="82" y="270" fill="#b7afc3" font-size="16">RIFT POINTS</text><text x="82" y="315" fill="#fff" font-size="36" font-weight="700">${data.points}</text><text x="285" y="270" fill="#b7afc3" font-size="16">MESSAGES</text><text x="285" y="315" fill="#fff" font-size="36" font-weight="700">${data.messages}</text><text x="488" y="270" fill="#b7afc3" font-size="16">VOICE HOURS</text><text x="488" y="315" fill="#fff" font-size="36" font-weight="700">${data.voiceHours.toFixed(1)}h</text><text x="690" y="270" fill="#b7afc3" font-size="16">COMPLAINTS</text><text x="690" y="315" fill="#fff" font-size="36" font-weight="700">${data.complaints}</text><text x="82" y="370" fill="#b7afc3" font-size="16">SHIFT HOURS</text><text x="82" y="405" fill="#c8bcff" font-size="24" font-weight="700">${data.shiftHours.toFixed(1)}h</text><text x="285" y="370" fill="#b7afc3" font-size="16">HELPED</text><text x="285" y="405" fill="#c8bcff" font-size="24" font-weight="700">${data.helped ?? 0}</text><text x="488" y="370" fill="#b7afc3" font-size="16">RATING</text><text x="488" y="405" fill="#f5c451" font-size="24" font-weight="700">${escapeXml(rating)}</text><text x="690" y="370" fill="#b7afc3" font-size="16">REVIEWERS</text><text x="690" y="405" fill="#c8bcff" font-size="24" font-weight="700">${data.ratingCount ?? 0}</text></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
