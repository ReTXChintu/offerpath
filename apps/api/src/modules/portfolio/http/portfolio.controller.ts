import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { Problems } from '../../../common/http/problem-details.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  PortfolioService,
  type ItemKind,
  type MessageItem,
  type PortfolioView,
} from '../application/portfolio.service.js';
import { ProfileImportService } from '../application/profile-import.service.js';
import { HEX } from '../domain/site.js';

const text = (max: number) => z.string().trim().max(max);
const url = z.string().trim().max(2_000);
const colour = z
  .string()
  .trim()
  .regex(HEX, 'Use a colour like #4f46e5')
  .transform((c) => c.toLowerCase());
const list = (max: number, each: number) => z.array(z.string().trim().min(1).max(each)).max(max);

const settingsSchema = z
  .object({
    heroName: text(120),
    heroEyebrow: text(120),
    roles: list(12, 120),
    heroBio: text(2_000),
    resumeUrl: url,
    aboutHeadline: text(200),
    aboutParagraphs: list(12, 3_000),
    socials: z.object({ github: url, linkedin: url, twitter: url, email: url }).partial().strict(),
  })
  .partial()
  .strict();

const handle = z.string().trim().toLowerCase();

const createPortfolioSchema = z.object({ handle });
const updatePortfolioSchema = z
  .object({ handle: handle.optional(), settings: settingsSchema.optional() })
  .strict();

const cloudinarySchema = z.object({
  cloudName: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(100),
  apiSecret: z.string().trim().min(1).max(200),
});

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  // 8 MB of image is about 11 MB of base64; the body limit is 6 MB, which wins.
  contentBase64: z.string().min(1).max(11_200_000),
});

const follows = { followsSource: z.boolean() };

const SCHEMAS: Record<ItemKind, z.ZodObject<z.ZodRawShape>> = {
  projects: z
    .object({
      title: text(200).min(2),
      desc: text(5_000).min(10),
      tags: list(30, 60),
      accent: colour,
      gradientFrom: colour,
      gradientTo: colour,
      imageUrl: url.min(1).nullable(),
      liveUrl: url,
      githubUrl: url,
      domain: text(80),
      order: z.number().int().min(0),
      published: z.boolean(),
      localPath: text(1_000).nullable(),
      ...follows,
    })
    .strict(),
  skills: z
    .object({
      cat: text(80).min(2),
      items: list(60, 80),
      order: z.number().int().min(0),
      published: z.boolean(),
      ...follows,
    })
    .strict(),
  experience: z
    .object({
      title: text(200).min(2),
      company: text(200).min(2),
      period: text(80).min(2),
      bullets: list(20, 1_000),
      order: z.number().int().min(0),
      published: z.boolean(),
      ...follows,
    })
    .strict(),
  'developer-tools': z
    .object({
      title: text(200).min(2),
      shortDescription: text(500).min(10),
      fullDescription: text(10_000),
      domain: text(80),
      techStacks: list(30, 60),
      accent: colour,
      gradientFrom: colour,
      gradientTo: colour,
      githubUrl: url,
      npmUrl: url,
      docsUrl: url,
      demoUrl: url,
      installCommand: text(500),
      packageName: text(214),
      version: text(50),
      featured: z.boolean(),
      published: z.boolean(),
      sortOrder: z.number().int().min(0),
    })
    .strict(),
};

/** What creating an item needs at least; the rest have defaults. */
const REQUIRED: Record<ItemKind, string[]> = {
  projects: ['title', 'desc'],
  skills: ['cat'],
  experience: ['title', 'company', 'period'],
  'developer-tools': ['title', 'shortDescription'],
};

const KIND_PATHS: Record<string, ItemKind> = {
  projects: 'projects',
  skills: 'skills',
  experience: 'experience',
  'developer-tools': 'developer-tools',
};

function kindOf(path: string): ItemKind {
  const kind = KIND_PATHS[path];
  if (!kind) throw Problems.notFound(`Portfolio list "${path}"`);
  return kind;
}

/** Validates an item body for create (required fields) or update (any subset). */
function parseItem(kind: ItemKind, body: unknown, creating: boolean): Record<string, unknown> {
  const schema = creating
    ? SCHEMAS[kind]
        .partial()
        .required(Object.fromEntries(REQUIRED[kind].map((k) => [k, true])) as Record<string, true>)
    : SCHEMAS[kind].partial();
  return new ZodValidationPipe(schema).transform(body, { type: 'body' }) as Record<string, unknown>;
}

/** The user's portfolio content, for Offerpath's own screens (docs/portfolio.md). */
@ApiTags('portfolio')
@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(
    private readonly portfolios: PortfolioService,
    private readonly profile: ProfileImportService,
  ) {}

  @Get()
  view(@CurrentUser() user: AuthenticatedUser): Promise<PortfolioView> {
    return this.portfolios.view(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create the portfolio; the profile comes in as drafts' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPortfolioSchema)) body: z.infer<typeof createPortfolioSchema>,
  ): Promise<PortfolioView> {
    await this.portfolios.create(user.userId, body.handle);
    await this.profile.import(user.userId);
    return this.portfolios.view(user.userId);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updatePortfolioSchema)) body: z.infer<typeof updatePortfolioSchema>,
  ): Promise<PortfolioView> {
    return this.portfolios.update(user.userId, body);
  }

  @Put('cloudinary')
  @ApiOperation({
    summary: "Connect the user's Cloudinary (checked first; secret stored encrypted)",
  })
  saveCloudinary(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cloudinarySchema)) body: z.infer<typeof cloudinarySchema>,
  ): Promise<PortfolioView> {
    return this.portfolios.saveCloudinary(user.userId, body);
  }

  @Delete('cloudinary')
  removeCloudinary(@CurrentUser() user: AuthenticatedUser): Promise<PortfolioView> {
    return this.portfolios.removeCloudinary(user.userId);
  }

  @Post('uploads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Upload an image to the user's Cloudinary" })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ): Promise<{ url: string }> {
    return this.portfolios.upload(user.userId, body.fileName, body.contentBase64);
  }

  @Post('import-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bring new profile items in as drafts now' })
  async importProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ created: number; updated: number }> {
    await this.portfolios.mine(user.userId);
    return this.profile.import(user.userId);
  }

  // -- Messages (declared before the item routes' ":list" paths) ---------------------

  @Get('messages')
  async messages(@CurrentUser() user: AuthenticatedUser): Promise<{ items: MessageItem[] }> {
    return { items: await this.portfolios.messages(user.userId) };
  }

  @Patch('messages/:id')
  markMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ read: z.boolean() }))) body: { read: boolean },
  ): Promise<MessageItem> {
    return this.portfolios.markMessage(user.userId, id, body.read);
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.portfolios.removeMessage(user.userId, id);
  }

  // -- Projects, skills, experience, developer tools ------------------------------------

  @Get(':list')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list') list: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    return { items: await this.portfolios.list(user.userId, kindOf(list)) };
  }

  @Post(':list/reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list') list: string,
    @Body(new ZodValidationPipe(z.object({ ids: z.array(z.string().min(1)).max(500) })))
    body: { ids: string[] },
  ): Promise<{ items: Record<string, unknown>[] }> {
    return { items: await this.portfolios.reorder(user.userId, kindOf(list), body.ids) };
  }

  @Post(':list')
  createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list') list: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const kind = kindOf(list);
    return this.portfolios.createItem(user.userId, kind, parseItem(kind, body, true));
  }

  @Patch(':list/:id')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list') list: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const kind = kindOf(list);
    return this.portfolios.updateItem(user.userId, kind, id, parseItem(kind, body, false));
  }

  @Delete(':list/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('list') list: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.portfolios.removeItem(user.userId, kindOf(list), id);
  }
}
