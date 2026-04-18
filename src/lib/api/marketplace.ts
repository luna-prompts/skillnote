import { getApiBaseUrl } from './client'

export function marketplaceUrl(slug: string): string {
  return `${getApiBaseUrl()}/marketplace/${slug}.json`
}
