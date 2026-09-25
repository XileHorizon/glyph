/**
 * Where the side key sits on the phones Glyph is likely to meet.
 *
 * Matt: "research the rough position of the button on all modern flagship
 * phones … and on the 'Hold. Talk. Done.' first page have waves emanating
 * from that button spot". The guide's first page draws its waves out of the
 * screen edge where the key is, so the picture is of THIS phone, not a phone.
 *
 * The positions are rough, read off the phones themselves: the edge the key
 * is on, seen from the front, and how far down it, as a fraction of the
 * phone's height to the middle of the key. Makers mostly agree - right edge,
 * a bit above the middle - and differ in one thing: Google puts the power
 * key ABOVE the volume rocker, everyone else below it, and Sony puts it dead
 * centre with a camera shutter under it. Exact millimetres are not published
 * and would not survive a case anyway.
 *
 * A phone is known by the model in its user agent (`SM-F971U1`, `Pixel 10
 * Pro`, `CPH2649`) and, failing that, by its maker (MainActivity.deviceMaker,
 * `Build.MANUFACTURER`), which is enough to pick the right side and a
 * plausible height. Anything else gets the common case. The list is also
 * kept as a database in Matt's Notion, "Side keys on flagship phones".
 */

export type Edge = 'right' | 'left';

export interface SideKeySpot {
  /** The phones this row covers, for people. */
  phone: string;
  maker: string;
  /** Matched against the user agent's model, or the maker for a row that stands for a whole brand. */
  models: RegExp;
  /** The edge the key is on, seen from the front. */
  edge: Edge;
  /** How far down that edge the middle of the key sits, as a fraction of the phone's height. */
  at: number;
  /** Where it is in relation to the volume rocker, and anything else worth knowing. */
  note: string;
}

/** Most phones: right edge, a little above the middle, below the volume rocker. */
export const COMMON: SideKeySpot = {
  phone: 'Most phones',
  maker: '',
  models: /$^/,
  edge: 'right',
  at: 0.4,
  note: 'Below the volume rocker, a little above the middle of the right edge.',
};

export const SIDE_KEYS: readonly SideKeySpot[] = [
  // Samsung: the Side key, below the volume rocker on the right. Foldables have the fingerprint reader in it.
  { phone: 'Galaxy S25, S25+, S25 Ultra, S25 Edge, S25 FE', maker: 'Samsung', models: /^SM-S93\d|^SM-S937|^SM-S731/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'Galaxy S24, S24+, S24 Ultra, S24 FE', maker: 'Samsung', models: /^SM-S92\d|^SM-S721/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'Galaxy S26 series', maker: 'Samsung', models: /^SM-S94\d/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'Galaxy Z Fold7, Fold6, Fold8', maker: 'Samsung', models: /^SM-F9[5-9]\d/, edge: 'right', at: 0.38, note: 'The key with the fingerprint reader, below the volume rocker; on the cover screen’s right edge closed, the right edge open.' },
  { phone: 'Galaxy Z Flip7, Flip6, Flip7 FE', maker: 'Samsung', models: /^SM-F7[4-9]\d/, edge: 'right', at: 0.3, note: 'On the upper half when open, below the volume rocker; the fingerprint reader is in it.' },
  { phone: 'Galaxy A and other Samsung phones', maker: 'Samsung', models: /^SM-/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  // Google: power key above the volume rocker, high on the right.
  { phone: 'Pixel 9 Pro Fold, Pixel 10 Pro Fold', maker: 'Google', models: /\bPixel (9|10) Pro Fold\b/, edge: 'right', at: 0.33, note: 'Above the volume rocker, high on the right; the fingerprint reader is in it.' },
  { phone: 'Pixel 10, 10 Pro, 10 Pro XL, 10a', maker: 'Google', models: /\bPixel 10\b/, edge: 'right', at: 0.31, note: 'Above the volume rocker, high on the right: the other way round from most phones.' },
  { phone: 'Pixel 9, 9 Pro, 9 Pro XL, 9a', maker: 'Google', models: /\bPixel 9\b/, edge: 'right', at: 0.31, note: 'Above the volume rocker, high on the right.' },
  { phone: 'Pixel 8 and earlier Pixels', maker: 'Google', models: /\bPixel\b/, edge: 'right', at: 0.31, note: 'Above the volume rocker, high on the right.' },
  // OnePlus: power key below the volume rocker on the right; the alert slider moved to the left on the 13.
  { phone: 'OnePlus 13, 13R, 13T, 15', maker: 'OnePlus', models: /^CPH26(49|53|55|91)|^CPH27|^PJZ110|^PKG110/, edge: 'right', at: 0.38, note: 'Below the volume rocker, on the right; the alert slider is on the left edge.' },
  { phone: 'OnePlus 12, 12R, Open', maker: 'OnePlus', models: /^CPH25(51|53|83|85)|^CPH2551|^PJD110/, edge: 'right', at: 0.4, note: 'Below the alert slider and the volume rocker, on the right.' },
  // Xiaomi: power key below the volume rocker on the right.
  { phone: 'Xiaomi 15, 15 Pro, 15 Ultra, 15T, 15T Pro', maker: 'Xiaomi', models: /^24129PN74G|^25010PN30G|^2412DPC0AG|^2507DPC0AG|^250(6|7)/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'Xiaomi 14, 14 Ultra, 14T Pro', maker: 'Xiaomi', models: /^23127PN0CG|^24030PN60G|^2407FPN8EG/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  // Nothing: power on the right, volume on the LEFT.
  { phone: 'Nothing Phone (3), Phone (3a), Phone (3a) Pro', maker: 'Nothing', models: /^A059|^A05[0-9]/, edge: 'right', at: 0.4, note: 'Alone on the right, a little above the middle; the volume rocker is on the left edge.' },
  { phone: 'Nothing Phone (2), Phone (2a)', maker: 'Nothing', models: /^A06[5-9]|^A142|^A065/, edge: 'right', at: 0.4, note: 'Alone on the right; the volume rocker is on the left edge.' },
  // Sony: power key with the fingerprint reader at the middle of the right edge, the shutter below it.
  { phone: 'Xperia 1 VII, 1 VI, 5 V, 10 VI', maker: 'Sony', models: /^XQ-/, edge: 'right', at: 0.5, note: 'Dead centre of the right edge, with the fingerprint reader; the volume rocker above it, the camera shutter below.' },
  // Motorola: power key with the fingerprint reader below the volume rocker; the Razrs put it on the upper half.
  { phone: 'Motorola Razr Ultra, Razr 60, Razr 50', maker: 'Motorola', models: /\brazr\b/i, edge: 'right', at: 0.34, note: 'On the upper half when open, below the volume rocker, with the fingerprint reader; the Ultra has an AI key on the left.' },
  { phone: 'Motorola Edge 60 Pro, Edge 50 Ultra, Edge 50 Pro', maker: 'Motorola', models: /\bedge\b/i, edge: 'right', at: 0.44, note: 'Below the volume rocker, on the right; the Edge 60 has an AI key on the left.' },
  // Honor, Oppo, vivo: power key below the volume rocker on the right; their foldables a little higher.
  { phone: 'Honor Magic V3, Magic V5', maker: 'Honor', models: /^FCP-|^VNA-|^DDA-/, edge: 'right', at: 0.36, note: 'Below the volume rocker, on the right edge, with the fingerprint reader.' },
  { phone: 'Honor Magic7 Pro, Magic6 Pro, Magic7', maker: 'Honor', models: /^BVL-|^BVR-|^PTP-|^HNA-/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'Oppo Find N5, Find N3', maker: 'Oppo', models: /^CPH2671|^CPH2499/, edge: 'right', at: 0.38, note: 'Below the volume rocker on the right edge, with the fingerprint reader; the alert slider is above.' },
  { phone: 'Oppo Find X8, X8 Pro, X8 Ultra, X9', maker: 'Oppo', models: /^CPH26(51|59|61|67)|^CPH27(0[0-9]|1[0-9])/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right; the Pro and Ultra have a Quick button lower down the same edge.' },
  { phone: 'vivo X Fold5, X Fold3 Pro', maker: 'vivo', models: /^V2504|^V2337|^V2426/, edge: 'right', at: 0.36, note: 'Below the volume rocker on the right edge, with the fingerprint reader.' },
  { phone: 'vivo X200, X200 Pro, X200 Ultra, X300', maker: 'vivo', models: /^V24(1[0-9]|2[0-9])|^V25/, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  // Asus, Fairphone.
  { phone: 'ROG Phone 9, 9 Pro, Zenfone 12 Ultra', maker: 'Asus', models: /^ASUS_AI25|^ASUS_AI24/, edge: 'right', at: 0.45, note: 'Below the volume rocker, on the right; the ROG has shoulder triggers at the corners.' },
  { phone: 'Fairphone 6, Fairphone 5', maker: 'Fairphone', models: /^FP6|^FP5/, edge: 'right', at: 0.4, note: 'Below the volume rocker, on the right, with the fingerprint reader.' },
];

/** What a maker usually does, when the model itself is not in the list. */
const BY_MAKER: readonly SideKeySpot[] = [
  { phone: 'A Samsung phone', maker: 'Samsung', models: /samsung/i, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'A Pixel', maker: 'Google', models: /google/i, edge: 'right', at: 0.31, note: 'Above the volume rocker, high on the right.' },
  { phone: 'A OnePlus phone', maker: 'OnePlus', models: /oneplus/i, edge: 'right', at: 0.38, note: 'Below the volume rocker, on the right.' },
  { phone: 'A Xiaomi phone', maker: 'Xiaomi', models: /xiaomi|redmi|poco/i, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'A Nothing phone', maker: 'Nothing', models: /nothing/i, edge: 'right', at: 0.4, note: 'Alone on the right; the volume rocker is on the left.' },
  { phone: 'An Xperia', maker: 'Sony', models: /sony/i, edge: 'right', at: 0.5, note: 'The middle of the right edge.' },
  { phone: 'A Motorola phone', maker: 'Motorola', models: /motorola/i, edge: 'right', at: 0.44, note: 'Below the volume rocker, on the right.' },
  { phone: 'An Honor phone', maker: 'Honor', models: /honor/i, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'An Oppo phone', maker: 'Oppo', models: /oppo|realme/i, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'A vivo phone', maker: 'vivo', models: /vivo|iqoo/i, edge: 'right', at: 0.42, note: 'Below the volume rocker, on the right.' },
  { phone: 'An Asus phone', maker: 'Asus', models: /asus/i, edge: 'right', at: 0.45, note: 'Below the volume rocker, on the right.' },
  { phone: 'A Fairphone', maker: 'Fairphone', models: /fairphone/i, edge: 'right', at: 0.4, note: 'Below the volume rocker, on the right.' },
];

/** The model in an Android user agent: `Mozilla/5.0 (Linux; Android 16; SM-F971U1 Build/…)` gives `SM-F971U1`. */
export function modelOf(userAgent: string): string {
  const match = /Android [\d.]+;\s*(?:[a-z]{2}-[a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/| wv\)|\))/i.exec(userAgent);
  return match ? (match[1] ?? '').trim() : '';
}

/** The row for this phone: by its model, else by its maker, else the common case. */
export function sideKeySpot(userAgent: string, maker: string): SideKeySpot {
  const model = modelOf(userAgent);
  if (model) {
    const known = SIDE_KEYS.find((spot) => spot.models.test(model));
    if (known) return known;
  }
  const brand = BY_MAKER.find((spot) => spot.models.test(maker) || spot.models.test(model));
  return brand ?? COMMON;
}

/**
 * Where the key is on the SCREEN, as a fraction of the screen's height: the
 * display starts a little way down the phone and ends a little short of its
 * foot, so a point on the phone sits proportionally higher on the display.
 * Bezels on these phones run two to three per cent top and bottom.
 */
export function onScreen(at: number): number {
  const top = 0.025;
  const shown = 0.95;
  return Math.min(0.9, Math.max(0.1, (at - top) / shown));
}
