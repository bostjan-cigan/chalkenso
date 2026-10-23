-- Drafts made in the app run in the background as proposals: one AI couldn't finish is FAILED.

-- AlterEnum
ALTER TYPE "public"."AiProposalStatus" ADD VALUE 'FAILED';
