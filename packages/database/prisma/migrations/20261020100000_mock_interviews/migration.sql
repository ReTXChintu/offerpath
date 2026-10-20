-- CreateEnum
CREATE TYPE "MockInterviewStatus" AS ENUM ('IN_PROGRESS', 'REPORTING', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MockInterviewStage" AS ENUM ('INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP');

-- AlterEnum
ALTER TYPE "PrepQuestionKind" ADD VALUE 'DSA';

-- AlterTable
ALTER TABLE "interview_preps" ADD COLUMN     "includeDsa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resumeFileName" TEXT,
ADD COLUMN     "resumeSource" TEXT,
ADD COLUMN     "resumeText" TEXT;

-- CreateTable
CREATE TABLE "mock_interviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prepId" TEXT NOT NULL,
    "status" "MockInterviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "stage" "MockInterviewStage" NOT NULL DEFAULT 'INTRO',
    "aiSource" TEXT,
    "report" JSONB,
    "overallScore" DOUBLE PRECISION,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_interview_turns" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "stage" "MockInterviewStage" NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "code" TEXT,
    "codeLanguage" TEXT,
    "problem" JSONB,
    "language" JSONB,
    "assessment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_interview_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mock_interviews_prepId_startedAt_idx" ON "mock_interviews"("prepId", "startedAt");

-- CreateIndex
CREATE INDEX "mock_interviews_userId_status_idx" ON "mock_interviews"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mock_interview_turns_interviewId_order_key" ON "mock_interview_turns"("interviewId", "order");

-- AddForeignKey
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_prepId_fkey" FOREIGN KEY ("prepId") REFERENCES "interview_preps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_interview_turns" ADD CONSTRAINT "mock_interview_turns_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "mock_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

