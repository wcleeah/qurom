import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { Agent, type AgentOptions } from "@cursor/sdk"

import { getCursorModelPricingTable } from "./cursor-pricing"

const execFileAsync = promisify(execFile)

export const CURSOR_PRICING_SYNC_PROMPT = `Update the Cursor model pricing map in this repository from https://cursor.com/docs/models-and-pricing.

Refresh PRICING_ROWS in scripts/sync-cursor-model-pricing.ts from the current docs table, then run \`bun run scripts/sync-cursor-model-pricing.ts\` to regenerate defaults/cursor-model-pricing.json with live model IDs. Open a pull request with the updated map.`

export type CursorPricingSyncLaunch = {
  agentId: string
  agentUrl: string
  repoUrl: string
  startedAt: string
}

export type CursorPricingSyncAgent = {
  agentId: string
  send: (prompt: string) => Promise<unknown>
}

export function cursorPricingAgentUrl(agentId: string): string {
  return `https://cursor.com/agents/${agentId}`
}

export function githubHttpsUrlFromRemote(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\.git$/, "")
  const ssh = trimmed.match(/^git@github\.com:(.+)$/i)
  if (ssh?.[1]) return `https://github.com/${ssh[1]}`
  const https = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/(.+)$/i)
  if (https?.[1]) return `https://github.com/${https[1]}`
  return undefined
}

export function githubHttpsUrlFromSlugOrRemote(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const fromRemote = githubHttpsUrlFromRemote(trimmed)
  if (fromRemote) return fromRemote
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}`
  return undefined
}

async function readGitOriginUrl(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function resolvePricingSyncRepoUrl(input: {
  githubRepo?: string
  workspaceDir?: string
  readRemote?: (cwd: string) => Promise<string | undefined>
}): Promise<string | undefined> {
  const fromEnv = githubHttpsUrlFromSlugOrRemote(input.githubRepo)
  if (fromEnv) return fromEnv
  if (!input.workspaceDir) return undefined
  const remote = await (input.readRemote ?? readGitOriginUrl)(input.workspaceDir)
  return remote ? githubHttpsUrlFromRemote(remote) : undefined
}

export function currentCursorPricingSyncedAt(): string | undefined {
  return getCursorModelPricingTable().syncedAt
}

let createAgentForTests: ((options: AgentOptions) => Promise<CursorPricingSyncAgent>) | undefined

export function setCursorPricingSyncCreateAgentForTests(
  createAgent?: (options: AgentOptions) => Promise<CursorPricingSyncAgent>,
) {
  createAgentForTests = createAgent
}

export async function launchCursorPricingSyncAgent(input: {
  apiKey?: string
  githubRepo?: string
  workspaceDir?: string
  createAgent?: (options: AgentOptions) => Promise<CursorPricingSyncAgent>
}): Promise<CursorPricingSyncLaunch> {
  const apiKey = input.apiKey?.trim()
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set")

  const repoUrl = await resolvePricingSyncRepoUrl({
    githubRepo: input.githubRepo,
    workspaceDir: input.workspaceDir,
  })
  if (!repoUrl) {
    throw new Error("Set QUORUM_GITHUB_REPO or run from a git checkout with origin so the Cursor agent can clone this repository.")
  }

  const createAgent = input.createAgent ?? createAgentForTests ?? ((options) => Agent.create(options))
  const agent = await createAgent({
    apiKey,
    name: "Update Cursor pricing map",
    cloud: {
      repos: [{ url: repoUrl }],
      autoCreatePR: true,
    },
  })
  await agent.send(CURSOR_PRICING_SYNC_PROMPT)
  return {
    agentId: agent.agentId,
    agentUrl: cursorPricingAgentUrl(agent.agentId),
    repoUrl,
    startedAt: new Date().toISOString(),
  }
}
