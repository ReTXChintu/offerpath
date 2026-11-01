import { createHash } from 'node:crypto';

export interface CloudinaryAccount {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export class CloudinaryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloudinaryError';
  }
}

const API = 'https://api.cloudinary.com/v1_1';

/**
 * The two Cloudinary calls the portfolio needs, on the user's own account:
 * checking the credentials, and a signed image upload. Plain REST, so no SDK.
 */
export class CloudinaryClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Throws CloudinaryError when Cloudinary refuses the credentials. */
  async check(account: CloudinaryAccount): Promise<void> {
    const auth = Buffer.from(`${account.apiKey}:${account.apiSecret}`).toString('base64');
    const res = await this.fetchImpl(`${API}/${encodeURIComponent(account.cloudName)}/usage`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new CloudinaryError(await errorOf(res), res.status);
  }

  /** Uploads an image into `folder`; returns its https URL. */
  async upload(
    account: CloudinaryAccount,
    image: { bytes: Buffer; mime: string },
    folder: string,
  ): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Signed parameters, sorted by name, then the secret (Cloudinary's scheme).
    const signature = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${account.apiSecret}`)
      .digest('hex');
    const form = new FormData();
    form.set('file', `data:${image.mime};base64,${image.bytes.toString('base64')}`);
    form.set('api_key', account.apiKey);
    form.set('timestamp', timestamp);
    form.set('folder', folder);
    form.set('signature', signature);

    const res = await this.fetchImpl(
      `${API}/${encodeURIComponent(account.cloudName)}/image/upload`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new CloudinaryError(await errorOf(res), res.status);
    const body = (await res.json()) as { secure_url?: string };
    if (!body.secure_url) throw new CloudinaryError('Cloudinary returned no URL', 502);
    return body.secure_url;
  }
}

async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return `Cloudinary answered ${res.status}`;
}
