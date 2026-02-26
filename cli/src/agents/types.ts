export interface AgentAdapter {
  name: string
  displayName: string
  detect(): boolean
  skillDir(skillSlug: string): string
  postInstall?(skillSlug: string): void
}
