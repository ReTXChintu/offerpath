-- Live practice moves to an OpenAI Realtime session: a question heard and a
-- direct answer, no transcript lines and no grading. Questions already saved
-- are kept as exchanges (their fuller answer, else the summary).

-- CreateTable
CREATE TABLE "live_practice_exchanges" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "answerFor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_practice_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_practice_exchanges_sessionId_order_key" ON "live_practice_exchanges"("sessionId", "order");

-- AddForeignKey
ALTER TABLE "live_practice_exchanges" ADD CONSTRAINT "live_practice_exchanges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "live_practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep what was saved
INSERT INTO "live_practice_exchanges" ("id", "sessionId", "order", "question", "answer", "answerFor", "createdAt")
SELECT "id", "sessionId", "order", "text",
       COALESCE(NULLIF("aiAnswer"->>'detail', ''), "aiAnswer"->>'summary', ''),
       "answerFor", "createdAt"
FROM "live_practice_questions";

-- DropForeignKey
ALTER TABLE "live_practice_lines" DROP CONSTRAINT "live_practice_lines_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "live_practice_questions" DROP CONSTRAINT "live_practice_questions_sessionId_fkey";

-- DropTable
DROP TABLE "live_practice_lines";

-- DropTable
DROP TABLE "live_practice_questions";
