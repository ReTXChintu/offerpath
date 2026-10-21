-- CreateEnum
CREATE TYPE "LivePracticeStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "live_practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prepId" TEXT,
    "title" TEXT NOT NULL,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answerFor" TEXT NOT NULL DEFAULT 'me',
    "status" "LivePracticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_practice_lines" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "questionId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_practice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_practice_questions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "answerFor" TEXT NOT NULL,
    "aiAnswer" JSONB NOT NULL,
    "score" INTEGER,
    "feedback" JSONB,
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_practice_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_practice_sessions_userId_createdAt_idx" ON "live_practice_sessions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "live_practice_lines_sessionId_order_key" ON "live_practice_lines"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "live_practice_questions_sessionId_order_key" ON "live_practice_questions"("sessionId", "order");

-- AddForeignKey
ALTER TABLE "live_practice_sessions" ADD CONSTRAINT "live_practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_practice_sessions" ADD CONSTRAINT "live_practice_sessions_prepId_fkey" FOREIGN KEY ("prepId") REFERENCES "interview_preps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_practice_lines" ADD CONSTRAINT "live_practice_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "live_practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_practice_questions" ADD CONSTRAINT "live_practice_questions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "live_practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

