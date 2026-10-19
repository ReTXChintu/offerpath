-- CreateEnum
CREATE TYPE "InterviewPrepStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PrepQuestionKind" AS ENUM ('TECHNICAL', 'SYSTEM_DESIGN', 'CODING', 'BEHAVIORAL', 'COMPANY');

-- CreateTable
CREATE TABLE "ai_fallback_keys" (
    "userId" TEXT NOT NULL,
    "keyCipher" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "modelFast" TEXT,
    "modelReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_fallback_keys_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "interview_preps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT,
    "role" TEXT,
    "jobDescription" TEXT,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "InterviewPrepStatus" NOT NULL DEFAULT 'GENERATING',
    "error" TEXT,
    "plan" JSONB,
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_preps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_prep_questions" (
    "id" TEXT NOT NULL,
    "prepId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "PrepQuestionKind" NOT NULL,
    "topic" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "keyPoints" TEXT[],
    "difficulty" INTEGER NOT NULL,
    "answer" TEXT,
    "score" INTEGER,
    "feedback" JSONB,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_prep_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_preps_userId_scheduledAt_idx" ON "interview_preps"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "interview_prep_questions_prepId_order_idx" ON "interview_prep_questions"("prepId", "order");

-- AddForeignKey
ALTER TABLE "ai_fallback_keys" ADD CONSTRAINT "ai_fallback_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_preps" ADD CONSTRAINT "interview_preps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_prep_questions" ADD CONSTRAINT "interview_prep_questions_prepId_fkey" FOREIGN KEY ("prepId") REFERENCES "interview_preps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

