-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "heroName" TEXT NOT NULL DEFAULT '',
    "heroEyebrow" TEXT NOT NULL DEFAULT '',
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroBio" TEXT NOT NULL DEFAULT '',
    "resumeUrl" TEXT NOT NULL DEFAULT '',
    "aboutHeadline" TEXT NOT NULL DEFAULT '',
    "aboutParagraphs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialGithub" TEXT NOT NULL DEFAULT '',
    "socialLinkedin" TEXT NOT NULL DEFAULT '',
    "socialTwitter" TEXT NOT NULL DEFAULT '',
    "socialEmail" TEXT NOT NULL DEFAULT '',
    "cloudinaryCloud" TEXT,
    "cloudinaryKey" TEXT,
    "cloudinarySecret" TEXT,
    "dismissedSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_projects" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accent" TEXT NOT NULL DEFAULT '#818cf8',
    "gradientFrom" TEXT NOT NULL DEFAULT '#4f46e5',
    "gradientTo" TEXT NOT NULL DEFAULT '#0ea5e9',
    "imageUrl" TEXT,
    "liveUrl" TEXT NOT NULL DEFAULT '',
    "githubUrl" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sourceCollection" TEXT,
    "sourceId" TEXT,
    "followsSource" BOOLEAN NOT NULL DEFAULT false,
    "localPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_skill_groups" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sourceCollection" TEXT,
    "sourceId" TEXT,
    "followsSource" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_skill_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_experience" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sourceCollection" TEXT,
    "sourceId" TEXT,
    "followsSource" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_developer_tools" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "fullDescription" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL DEFAULT 'Developer Tooling',
    "techStacks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accent" TEXT NOT NULL DEFAULT '#818cf8',
    "gradientFrom" TEXT NOT NULL DEFAULT '#4f46e5',
    "gradientTo" TEXT NOT NULL DEFAULT '#0ea5e9',
    "githubUrl" TEXT NOT NULL DEFAULT '',
    "npmUrl" TEXT NOT NULL DEFAULT '',
    "docsUrl" TEXT NOT NULL DEFAULT '',
    "demoUrl" TEXT NOT NULL DEFAULT '',
    "installCommand" TEXT NOT NULL DEFAULT '',
    "packageName" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_developer_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_messages" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_userId_key" ON "portfolios"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_handle_key" ON "portfolios"("handle");

-- CreateIndex
CREATE INDEX "portfolio_projects_portfolioId_order_idx" ON "portfolio_projects"("portfolioId", "order");

-- CreateIndex
CREATE INDEX "portfolio_skill_groups_portfolioId_order_idx" ON "portfolio_skill_groups"("portfolioId", "order");

-- CreateIndex
CREATE INDEX "portfolio_experience_portfolioId_order_idx" ON "portfolio_experience"("portfolioId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_developer_tools_portfolioId_slug_key" ON "portfolio_developer_tools"("portfolioId", "slug");

-- CreateIndex
CREATE INDEX "portfolio_messages_portfolioId_createdAt_idx" ON "portfolio_messages"("portfolioId", "createdAt");

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_skill_groups" ADD CONSTRAINT "portfolio_skill_groups_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_experience" ADD CONSTRAINT "portfolio_experience_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_developer_tools" ADD CONSTRAINT "portfolio_developer_tools_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_messages" ADD CONSTRAINT "portfolio_messages_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

