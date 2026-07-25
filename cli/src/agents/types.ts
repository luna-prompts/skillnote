export interface AgentAdapter {
  name: string
  displayName: string
  detect(): boolean
  skillDir(skillSlug: string): string
  postInstall?(skillSlug: string): void
  /**
   * Where this adapter's skill files live.
   *
   * 'project' (default) — under the current project, so the per-project
   * manifest fully describes the install.
   * 'user' — a single user-global directory shared by every project on the
   * machine. Installs must be reference-counted, otherwise removing a skill
   * in one project silently deletes the copy another project still lists.
   */
  scope?: 'project' | 'user'
}
