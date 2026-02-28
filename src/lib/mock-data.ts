export type Reaction = {
  emoji: string
  count: number
}

export type TeamMember = {
  name: string
  color: string
}

export type Comment = {
  id: string
  author: string
  avatar_color: string
  body: string
  created_at: string
  reactions: Reaction[]
}

export type Attachment = {
  id: string
  filename: string
  size: number
  type: string
  uploaded_at: string
  uploader?: string
}

export type DiffLine = {
  type: 'add' | 'remove' | 'context'
  lineOld: number | null
  lineNew: number | null
  text: string
}

export type Revision = {
  id: string
  rev: number
  label: string
  time: string
  author: string
  avatar_color: string
  latest: boolean
  diff: DiffLine[]
}

export type ContentVersion = {
  version: number
  title: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
  is_latest: boolean
  created_at: string
}

export type Skill = {
  slug: string
  title: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
  current_version: number
  /** Total number of content versions (used for next version counter) */
  total_versions?: number
  created_by?: string
  created_at: string
  updated_at: string
  comments?: Comment[]
  attachments?: Attachment[]
  revisions?: Revision[]
}

export type Collection = {
  id: string
  name: string
  description: string
  skill_count: number
  updated_at: string
}

export type Tag = {
  id: string
  name: string
  skill_count: number
}

export const mockTeamMembers: TeamMember[] = [
  { name: 'Pat', color: '#8b5cf6' },
  { name: 'Rudra', color: '#ef4444' },
  { name: 'Tyler', color: '#3b82f6' },
  { name: 'Max', color: '#f59e0b' },
]

export const mockTags: Tag[] = [
  { id: '1', name: 'api', skill_count: 8 },
  { id: '2', name: 'react', skill_count: 12 },
  { id: '3', name: 'typescript', skill_count: 6 },
  { id: '4', name: 'testing', skill_count: 5 },
  { id: '5', name: 'workflow', skill_count: 9 },
  { id: '6', name: 'devops', skill_count: 4 },
  { id: '7', name: 'nextjs', skill_count: 7 },
]

export const mockCollections: Collection[] = [
  { id: '1', name: 'Frontend', description: 'All frontend skills', skill_count: 14, updated_at: '2026-02-20T10:00:00Z' },
  { id: '2', name: 'Backend', description: 'API and server skills', skill_count: 8, updated_at: '2026-02-19T10:00:00Z' },
  { id: '3', name: 'DevOps', description: 'CI/CD and infra skills', skill_count: 5, updated_at: '2026-02-18T10:00:00Z' },
  { id: '4', name: 'Testing', description: 'QA and testing workflows', skill_count: 6, updated_at: '2026-02-17T10:00:00Z' },
]

export const mockSkills: Skill[] = [
  {
    slug: 'react-component-patterns',
    title: 'React Component Patterns',
    description: 'Best practices for building reusable React components including compound components, render props, and hooks.',
    content_md: `\`\`\`tsx\nfunction useDebounce<T>(value: T, delay: number): T {\n  const [debounced, setDebounced] = useState(value)\n  useEffect(() => {\n    const timer = setTimeout(() => setDebounced(value), delay)\n    return () => clearTimeout(timer)\n  }, [value, delay])\n  return debounced\n}\n\`\`\``,
    tags: ['react', 'typescript'],
    collections: ['Frontend'],
    current_version: 3,
    created_by: 'Nova Vex',
    created_at: '2026-02-10T10:00:00Z',
    updated_at: '2026-02-20T14:30:00Z',
    comments: [
      { id: 'c1', author: 'Alex Chen', avatar_color: '#6366f1', body: 'Great breakdown of compound components! The TabsContext example is especially clear. Would love to see a section on higher-order components too.', created_at: '2026-02-18T09:30:00Z', reactions: [{ emoji: '👍', count: 3 }, { emoji: '🚀', count: 1 }] },
      { id: 'c2', author: 'Sarah Kim', avatar_color: '#ec4899', body: 'The useDebounce hook is exactly what I needed for my search input. One question — should the delay param have a default value?', created_at: '2026-02-19T14:15:00Z', reactions: [{ emoji: '❤️', count: 2 }] },
      { id: 'c3', author: 'Jordan Lee', avatar_color: '#f59e0b', body: 'Solid patterns. I\'d also recommend adding the Observer pattern for event-driven components. Works great with custom hooks.', created_at: '2026-02-20T11:00:00Z', reactions: [{ emoji: '👍', count: 5 }, { emoji: '🚀', count: 2 }] },
    ],
    attachments: [
      { id: 'a1', filename: 'component-diagram.png', size: 245760, type: 'image/png', uploaded_at: '2026-02-18T10:00:00Z', uploader: 'Nova Vex' },
      { id: 'a2', filename: 'patterns-cheatsheet.pdf', size: 1048576, type: 'application/pdf', uploaded_at: '2026-02-19T14:00:00Z', uploader: 'Alex Chen' },
      { id: 'a3', filename: 'useDebounce.ts', size: 2048, type: 'text/typescript', uploaded_at: '2026-02-20T09:00:00Z', uploader: 'Nova Vex' },
    ],
    revisions: [
      {
        id: 'r3', rev: 3, label: 'Added code examples and improved formatting', time: '2026-02-20T14:30:00Z',
        author: 'Nova Vex', avatar_color: '#0d9488', latest: true,
        diff: [
          { type: 'context', lineOld: 12, lineNew: 12, text: '## Custom Hooks' },
          { type: 'context', lineOld: 13, lineNew: 13, text: '' },
          { type: 'remove', lineOld: 14, lineNew: null, text: 'Extract logic into hooks.' },
          { type: 'add', lineOld: null, lineNew: 14, text: 'Extract stateful logic into reusable hooks.' },
          { type: 'add', lineOld: null, lineNew: 15, text: '' },
          { type: 'add', lineOld: null, lineNew: 16, text: '```tsx' },
          { type: 'add', lineOld: null, lineNew: 17, text: 'function useDebounce<T>(value: T, delay: number): T {' },
          { type: 'add', lineOld: null, lineNew: 18, text: '  const [debounced, setDebounced] = useState(value)' },
          { type: 'add', lineOld: null, lineNew: 19, text: '```' },
          { type: 'context', lineOld: 15, lineNew: 20, text: '' },
        ],
      },
      {
        id: 'r2', rev: 2, label: 'Expanded content with best practices section', time: '2026-02-15T10:00:00Z',
        author: 'Alex Chen', avatar_color: '#6366f1', latest: false,
        diff: [
          { type: 'context', lineOld: 4, lineNew: 4, text: '## Overview' },
          { type: 'context', lineOld: 5, lineNew: 5, text: '' },
          { type: 'remove', lineOld: 6, lineNew: null, text: 'Basic patterns for React.' },
          { type: 'add', lineOld: null, lineNew: 6, text: 'This skill covers the most effective patterns for building reusable React components.' },
          { type: 'context', lineOld: 7, lineNew: 7, text: '' },
          { type: 'add', lineOld: null, lineNew: 8, text: '## Compound Components' },
          { type: 'add', lineOld: null, lineNew: 9, text: '' },
          { type: 'add', lineOld: null, lineNew: 10, text: 'Compound components share state implicitly through context.' },
        ],
      },
      {
        id: 'r1', rev: 1, label: 'Initial version created', time: '2026-02-10T10:00:00Z',
        author: 'Nova Vex', avatar_color: '#0d9488', latest: false,
        diff: [],
      },
    ],
  },
  {
    slug: 'api-error-handling',
    title: 'API Error Handling',
    description: 'Structured approach to handling errors in REST APIs with proper status codes and response formats.',
    content_md: `- 400 Bad Request — invalid input\n- 401 Unauthorized — missing/invalid auth\n- 403 Forbidden — insufficient permissions\n- 404 Not Found — resource missing\n- 500 Internal Server Error — unexpected failure`,
    tags: ['api', 'typescript'],
    collections: ['Backend'],
    current_version: 1,
    created_by: 'Dev Patel',
    created_at: '2026-02-08T10:00:00Z',
    updated_at: '2026-02-19T09:00:00Z',
    comments: [
      { id: 'c4', author: 'Dev Patel', avatar_color: '#10b981', body: 'Really helpful error format. We adopted this at our company and it made debugging so much easier across the team.', created_at: '2026-02-17T16:00:00Z', reactions: [{ emoji: '👍', count: 4 }] },
    ],
  },
  {
    slug: 'tdd-workflow',
    title: 'TDD Workflow',
    description: 'Test-driven development workflow for writing reliable, maintainable code from day one.',
    content_md: `// Step 2: Minimal implementation\nfunction add(a: number, b: number) {\n  return a + b\n}\n\`\`\``,
    tags: ['testing', 'workflow'],
    collections: ['Frontend', 'Backend'],
    current_version: 1,
    created_by: 'Sarah Kim',
    created_at: '2026-02-05T10:00:00Z',
    updated_at: '2026-02-17T16:00:00Z',
  },
  {
    slug: 'nextjs-app-router',
    title: 'Next.js App Router Patterns',
    description: 'Routing, layouts, server components, and data fetching patterns for Next.js 13+ App Router.',
    content_md: `Default: Server Components (no JS sent to client)\nAdd \`'use client'\` only when you need browser APIs or interactivity.`,
    tags: ['nextjs', 'react'],
    collections: ['Frontend'],
    current_version: 1,
    created_by: 'Jordan Lee',
    created_at: '2026-02-12T10:00:00Z',
    updated_at: '2026-02-21T08:00:00Z',
  },
  {
    slug: 'trello',
    title: 'Trello Skill',
    description: 'Manage Trello boards, lists, and cards via the Trello REST API.',
    current_version: 1,
    content_md: `---\nname: trello\ndescription: Manage Trello boards, lists, and cards via the Trello REST API.\nhomepage: https://developer.atlassian.com/cloud/trello/rest/\nmetadata: {"clawdbot":{"emoji":"📋","requires":{"bins":["jq"],"env":["TRELLO_API_KEY","TRELLO_TOKEN"]}}}\n---\n# Trello Skill\n\nManage Trello boards, lists, and cards directly from Clawdbot.\n\n## Setup\n\n1. Get your API key: https://trello.com/app-key\n2. Generate a token (click "Token" link on that page)\n3. Set environment variables:\n\n\`\`\`bash\nexport TRELLO_API_KEY="your-api-key"\nexport TRELLO_TOKEN="your-token"\n\`\`\`\n\n## Usage\n\nAll commands use curl to hit the Trello REST API.\n\n### List boards\n\n\`\`\`bash\ncurl -s "https://api.trello.com/1/members/me/boards?key=\$TRELLO_API_KEY&token=\$TRELLO_TOKEN" | jq '.[] | {name, id}'\n\`\`\`\n\n### List lists in a board\n\n\`\`\`bash\ncurl -s "https://api.trello.com/1/boards/{boardId}/lists?key=\$TRELLO_API_KEY&token=\$TRELLO_TOKEN" | jq '.[] | {name, id}'\n\`\`\``,
    tags: ['api', 'productivity'],
    collections: ['Integrations'],
    created_at: '2026-02-23T00:00:00Z',
    updated_at: '2026-02-23T00:00:00Z',
  },
  {
    slug: 'docker-compose-setup',
    title: 'Docker Compose Setup',
    description: 'Standard Docker Compose configuration for local development with postgres, redis, and app containers.',
    content_md: `\`\`\`yaml\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: password\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n\`\`\``,
    tags: ['devops', 'workflow'],
    collections: ['DevOps'],
    current_version: 1,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-15T12:00:00Z',
  },
]
