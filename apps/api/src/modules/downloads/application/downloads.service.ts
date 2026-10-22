import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import type { AppConfig } from '@offerpath/config';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';

export type Platform = 'android' | 'windows';

export interface DownloadInfo {
  fileName: string;
  /** Semver from the file name, e.g. "0.2.0"; null if it doesn't carry one. */
  version: string | null;
  /** Android build number (versionCode) from the file name, when present. */
  build: number | null;
  sizeBytes: number;
  updatedAt: string;
  /** Path under the API prefix, e.g. "/api/v1/downloads/android". */
  url: string;
  /** Windows only: whether a Tauri updater signature sits next to it. */
  signed?: boolean;
}

/** The speaker model live practice recognises the user's voice with. */
export interface SpeakerModelInfo {
  fileName: string;
  sizeBytes: number;
  /** Hex; the phone checks the download against it. */
  sha256: string;
  url: string;
}

export const MIME: Record<Platform, string> = {
  android: 'application/vnd.android.package-archive',
  windows: 'application/vnd.microsoft.portable-executable',
};

const MATCHES: Record<Platform, (name: string) => boolean> = {
  android: (n) => n.toLowerCase().endsWith('.apk'),
  // NSIS installers from `tauri build`: "Offerpath_0.2.0_x64-setup.exe".
  windows: (n) => n.toLowerCase().endsWith('-setup.exe'),
};

/**
 * Version and build number from a build's file name:
 * `offerpath-0.2.0-15.apk` (CI's APK name) → 0.2.0, build 15;
 * `Offerpath_0.2.0_x64-setup.exe` → 0.2.0.
 */
export function parseBuildName(fileName: string): { version: string | null; build: number | null } {
  // A prerelease tag must start with a letter ("-rc.1") so it can't be
  // confused with a build number ("-15").
  const m = fileName.match(/(\d+\.\d+\.\d+(?:-[A-Za-z][0-9A-Za-z.]*)?)(?:[-+](\d+))?(?=[._-])/);
  if (!m) return { version: null, build: null };
  return { version: m[1]!, build: m[2] ? Number(m[2]) : null };
}

/**
 * The app builds CI uploads to the server: the newest APK and Windows
 * installer, and the manifest Tauri's updater reads. Nothing here needs auth:
 * the builds are not secret, and every piece of data behind them still is.
 */
@Injectable()
export class DownloadsService {
  readonly dir: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.dir = path.resolve(config.repoRoot, config.env.DOWNLOADS_DIR);
  }

  async newest(
    platform: Platform,
    prefix: string,
  ): Promise<{ fullPath: string; info: DownloadInfo } | null> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return null;
    }
    let best: { fullPath: string; name: string; size: number; mtime: Date } | null = null;
    for (const name of names) {
      if (!MATCHES[platform](name)) continue;
      const fullPath = path.join(this.dir, name);
      const s = await stat(fullPath).catch(() => null);
      if (!s?.isFile()) continue;
      if (!best || s.mtime > best.mtime) best = { fullPath, name, size: s.size, mtime: s.mtime };
    }
    if (!best) return null;
    const info: DownloadInfo = {
      fileName: best.name,
      ...parseBuildName(best.name),
      sizeBytes: best.size,
      updatedAt: best.mtime.toISOString(),
      url: `${prefix}/downloads/${platform}`,
    };
    if (platform === 'windows') {
      info.signed = !!(await stat(`${best.fullPath}.sig`).catch(() => null))?.isFile();
    }
    return { fullPath: best.fullPath, info };
  }

  /**
   * The speaker model for live practice's voice recognition: the newest
   * .onnx in <downloads>/models, put there by hand (docs/deploy.md). Its
   * checksum is worked out once per file version.
   */
  async speakerModel(prefix: string): Promise<{ fullPath: string; info: SpeakerModelInfo } | null> {
    const dir = path.join(this.dir, 'models');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    let best: { fullPath: string; name: string; size: number; mtime: Date } | null = null;
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.onnx')) continue;
      const fullPath = path.join(dir, name);
      const s = await stat(fullPath).catch(() => null);
      if (!s?.isFile()) continue;
      if (!best || s.mtime > best.mtime) best = { fullPath, name, size: s.size, mtime: s.mtime };
    }
    if (!best) return null;
    const key = `${best.fullPath}:${best.size}:${best.mtime.getTime()}`;
    if (this.modelHash?.key !== key) {
      this.modelHash = { key, sha256: await sha256(best.fullPath) };
    }
    return {
      fullPath: best.fullPath,
      info: {
        fileName: best.name,
        sizeBytes: best.size,
        sha256: this.modelHash.sha256,
        url: `${prefix}/downloads/speaker-model/file`,
      },
    };
  }

  private modelHash: { key: string; sha256: string } | null = null;

  /** Tauri's updater "static JSON", or null when there's no signed installer. */
  async windowsUpdateManifest(origin: string, prefix: string) {
    const build = await this.newest('windows', prefix);
    if (!build?.info.version || !build.info.signed) return null;
    const signature = (await readFile(`${build.fullPath}.sig`, 'utf8')).trim();
    return {
      version: build.info.version,
      notes: '',
      pub_date: build.info.updatedAt,
      platforms: {
        'windows-x86_64': { signature, url: `${origin}${build.info.url}` },
      },
    };
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}
