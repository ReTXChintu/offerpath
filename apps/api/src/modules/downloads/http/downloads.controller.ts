import { createReadStream } from 'node:fs';

import { Controller, Get, Inject, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import type { AppConfig } from '@offerpath/config';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import {
  DownloadsService,
  MIME,
  type DownloadInfo,
  type Platform,
} from '../application/downloads.service.js';

@ApiTags('downloads')
@Controller()
export class DownloadsController {
  constructor(
    private readonly downloads: DownloadsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get prefix(): string {
    return `/${this.config.env.API_GLOBAL_PREFIX}/v1`;
  }

  @Get('downloads')
  @ApiOperation({
    summary: 'The latest Android and Windows builds; the apps’ update checks read this',
  })
  async latest(): Promise<{ android: DownloadInfo | null; windows: DownloadInfo | null }> {
    const [android, windows] = await Promise.all([
      this.downloads.newest('android', this.prefix),
      this.downloads.newest('windows', this.prefix),
    ]);
    return { android: android?.info ?? null, windows: windows?.info ?? null };
  }

  @Get('downloads/android')
  android(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.send('android', res);
  }

  @Get('downloads/windows')
  windows(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return this.send('windows', res);
  }

  /** The manifest Tauri's updater reads for in-app updates (signed installers only). */
  @Get('updates/windows/latest.json')
  async windowsManifest(@Req() req: Request): Promise<unknown> {
    const origin = `${req.protocol}://${req.headers.host ?? req.hostname}`;
    const manifest = await this.downloads.windowsUpdateManifest(origin, this.prefix);
    if (!manifest) throw Problems.notFound('Signed Windows update');
    return manifest;
  }

  private async send(platform: Platform, res: Response): Promise<StreamableFile> {
    const build = await this.downloads.newest(platform, this.prefix);
    if (!build) {
      throw Problems.notFound(`${platform === 'android' ? 'Android' : 'Windows'} build`);
    }
    res.set({
      'Content-Type': MIME[platform],
      'Content-Length': String(build.info.sizeBytes),
      'Content-Disposition': `attachment; filename="${build.info.fileName}"`,
    });
    return new StreamableFile(createReadStream(build.fullPath));
  }
}
