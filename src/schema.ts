import { z } from "zod"

export const topicInputSchema = z.object({
  topic: z.string().min(1),
})

export const documentInputSchema = z.object({
  file: z.string().min(1),
})

export const researchRequestSchema = z.union([topicInputSchema, documentInputSchema])
