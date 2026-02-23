// SkillVault Service Worker — manifest registration only, no offline caching
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
