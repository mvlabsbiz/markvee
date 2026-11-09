'use strict';

/**
 * Explicit audiences for the personal site.
 * The only public resources are the landing biography already in public/index.html
 * and the stylesheet and script that hold no personal records.
 * Wireframe regions are approved-friend. Existing owner mutations stay owner-only.
 * Nothing here renders a new page or adds copy. The device controller is not a route
 * of this site.
 */

const SITE_ROUTES = Object.freeze([
  { method: 'GET', path: '/', audience: 'public', id: 'landing', evidence: 'public/index.html name, title, and biography' },
  { method: 'GET', path: '/style.css', audience: 'public', id: 'landing-style', evidence: 'public/style.css has no personal records' },
  { method: 'GET', path: '/script.js', audience: 'public', id: 'landing-script', evidence: 'public/script.js has no personal records' },

  { method: 'GET', path: '/api/posts', audience: 'approved-friend', id: 'posts', source: 'server.js GET /api/posts' },
  { method: 'GET', path: '/posts', audience: 'approved-friend', id: 'posts-section', wireframe: 'POsts:' },
  { method: 'GET', path: '/profile', audience: 'approved-friend', id: 'profile-photo', source: 'server.js GET /profile' },
  { method: 'GET', path: '/banner', audience: 'approved-friend', id: 'banner-photo', source: 'server.js GET /banner' },
  { method: 'GET', path: '/media/:id', audience: 'approved-friend', id: 'post-photo', source: 'server.js GET /media/' },
  { method: 'HEAD', path: '/media/:id', audience: 'approved-friend', id: 'post-photo-head', source: 'server.js GET /media/' },
  { method: 'GET', path: '/artwork/:id', audience: 'approved-friend', id: 'artwork', source: 'isolated review fixture' },
  { method: 'HEAD', path: '/artwork/:id', audience: 'approved-friend', id: 'artwork-head', source: 'isolated review fixture' },
  { method: 'GET', path: '/api/artwork', audience: 'approved-friend', id: 'artwork-index', source: 'isolated review fixture' },
  { method: 'GET', path: '/work', audience: 'approved-friend', id: 'work', wireframe: 'Work' },
  { method: 'GET', path: '/education', audience: 'approved-friend', id: 'education', wireframe: 'Education' },
  { method: 'GET', path: '/travel', audience: 'approved-friend', id: 'travel', wireframe: 'Travel' },
  { method: 'GET', path: '/links', audience: 'approved-friend', id: 'links', wireframe: 'Links' },
  { method: 'GET', path: '/contacts', audience: 'approved-friend', id: 'contacts', wireframe: 'Contacts' },
  { method: 'GET', path: '/hobbies', audience: 'approved-friend', id: 'hobbies', wireframe: 'Hobbies:' },
  { method: 'GET', path: '/projects', audience: 'approved-friend', id: 'projects', wireframe: 'Projects:' },
  { method: 'GET', path: '/photos/landscape', audience: 'approved-friend', id: 'landscape-photo', wireframe: 'Landscape Photo' },
  { method: 'GET', path: '/photos/profile', audience: 'approved-friend', id: 'wire-profile-picture', wireframe: 'My Profile' },
  { method: 'GET', path: '/photos/hobbies', audience: 'approved-friend', id: 'hobby-pictures', wireframe: 'Pictures I put here' },
  { method: 'GET', path: '/streaming/tv', audience: 'approved-friend', id: 'streaming-tv', wireframe: 'Tv/Movie' },
  { method: 'GET', path: '/streaming/music', audience: 'approved-friend', id: 'streaming-music', wireframe: 'music song' },
  { method: 'GET', path: '/streaming/podcast', audience: 'approved-friend', id: 'streaming-podcast', wireframe: 'podcast' },
  { method: 'GET', path: '/streaming/audiobook', audience: 'approved-friend', id: 'streaming-audiobook', wireframe: 'audiobook' },

  { method: 'POST', path: '/api/posts', audience: 'owner', id: 'create-post', source: 'server.js POST /api/posts' },
  { method: 'POST', path: '/api/profile', audience: 'owner', id: 'upload-profile', source: 'server.js POST /api/profile' },
  { method: 'POST', path: '/api/banner', audience: 'owner', id: 'upload-banner', source: 'server.js POST /api/banner' },
  { method: 'GET', path: '/api/owner/csrf', audience: 'owner', id: 'owner-csrf' },
  { method: 'GET', path: '/api/owner/queue', audience: 'owner', id: 'owner-queue' },
  { method: 'POST', path: '/api/owner/contacts/import', audience: 'owner', id: 'owner-import' },
  { method: 'POST', path: '/api/owner/accounts/:id/approve', audience: 'owner', id: 'owner-approve' },
  { method: 'POST', path: '/api/owner/accounts/:id/deny', audience: 'owner', id: 'owner-deny' },
  { method: 'POST', path: '/api/owner/accounts/:id/revoke', audience: 'owner', id: 'owner-revoke' },
  { method: 'POST', path: '/api/owner/accounts/:id/restore', audience: 'owner', id: 'owner-restore' },
  { method: 'POST', path: '/api/owner/number-changes/:id/approve', audience: 'owner', id: 'owner-number-change' },

  { method: 'GET', path: '/api/access/status', audience: 'access-flow', id: 'access-status' },
  { method: 'POST', path: '/api/access/phone/start', audience: 'access-flow', id: 'access-start' },
  { method: 'POST', path: '/api/access/phone/verify', audience: 'access-flow', id: 'access-verify' },
  { method: 'POST', path: '/api/access/introduction', audience: 'access-flow', id: 'access-introduction' },
  { method: 'POST', path: '/api/access/logout', audience: 'access-flow', id: 'access-logout' },
  { method: 'POST', path: '/api/access/number-change', audience: 'access-flow', id: 'access-number-change' },
  { method: 'POST', path: '/api/access/number-change/prove', audience: 'access-flow', id: 'access-number-proof' },

  { method: '*', path: '/devices', audience: 'out-of-scope', id: 'device-controller', evidence: 'separate internal app, not markvee.org' },
  { method: '*', path: '/devices/:id', audience: 'out-of-scope', id: 'device-controller-item', evidence: 'separate internal app, not markvee.org' },
  { method: '*', path: '/device', audience: 'out-of-scope', id: 'device-root', evidence: 'separate internal app, not markvee.org' },
  { method: '*', path: '/controller', audience: 'out-of-scope', id: 'controller-root', evidence: 'separate internal app, not markvee.org' },
]);

function pathRegex(routePath) {
  const escaped = routePath.split('/').map((part) => {
    if (part === ':id') return '[A-Za-z0-9_-]{1,200}';
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('\\/');
  return new RegExp(`^${escaped}$`);
}

function classifyRequest(method, pathname) {
  for (const route of SITE_ROUTES) {
    if (route.method !== '*' && route.method !== method) continue;
    if (pathRegex(route.path).test(pathname)) {
      return {
        audience: route.audience,
        id: route.id,
        path: route.path,
      };
    }
  }
  return { audience: 'unknown', id: 'unknown', path: pathname };
}

module.exports = { SITE_ROUTES, classifyRequest };
