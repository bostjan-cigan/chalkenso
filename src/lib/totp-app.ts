import 'server-only';

import QRCode from 'qrcode';

/** The QR code for an authenticator app, from the `otpauth://` address Better Auth gives (src/lib/auth.ts). */
export async function buildTotpQrDataUrl(keyUri: string) {
  return QRCode.toDataURL(keyUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 4,
    type: 'image/png',
  });
}
