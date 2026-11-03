const cfToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const githubToken = String(process.env.HENDY_GITHUB_TOKEN || '').trim();
const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const target = String(process.argv[2] || 'all').toLowerCase();

if (!cfToken || !accountId || !githubToken || !/^[^/]+\/[^/]+$/.test(repository)) {
  throw new Error('Domain sync needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, HENDY_GITHUB_TOKEN, and GITHUB_REPOSITORY. Use a GitHub token allowed to update Actions variables and dispatch workflows.');
}
if (!['miniapp','web','workers','all'].includes(target)) throw new Error('Target must be miniapp, web, workers, or all.');

const [owner, repo] = repository.split('/');
const projects = [
  { key: 'miniapp', name: String(process.env.MINIAPP_PAGES_PROJECT || 'hendy-mini-app').trim(), overrideKey: 'MINIAPP_DOMAIN_OVERRIDE', variable: 'MINIAPP_PUBLIC_URL', appVariable: 'APP_URL' },
  { key: 'admin', name: String(process.env.ADMIN_PAGES_PROJECT || 'hendy-web-admin').trim(), overrideKey: 'ADMIN_DOMAIN_OVERRIDE', variable: 'ADMIN_PUBLIC_URL', appVariable: 'ADMIN_URL' },
  { key: 'storefront', name: String(process.env.STOREFRONT_PAGES_PROJECT || 'hendy-app-storefront').trim(), overrideKey: 'STOREFRONT_DOMAIN_OVERRIDE', variable: 'STOREFRONT_PUBLIC_URL', appVariable: 'STOREFRONT_URL' },
];
const required = target === 'miniapp' ? new Set(['miniapp']) : target === 'web' ? new Set(['admin','storefront']) : target === 'all' ? new Set(projects.map((p) => p.key)) : new Set();
const workerRequired = target === 'workers' || target === 'all';
const headersCf = { authorization: 'Bearer ' + cfToken, accept: 'application/json' };
const headersGh = { authorization: 'Bearer ' + githubToken, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' };

async function github(path, init = {}) {
  const response = await fetch('https://api.github.com/repos/' + owner + '/' + repo + path, { ...init, headers: { ...headersGh, ...(init.headers || {}) } });
  if (!response.ok) throw new Error('GitHub API request failed (' + response.status + ') for ' + path);
  if (response.status === 204) return null;
  return response.json();
}

async function cloudflareProject(project) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/pages/projects/' + encodeURIComponent(project.name), { headers: headersCf });
  if (response.status === 404 && !required.has(project.key)) {
    console.log('Skipping Pages project that is not configured yet: ' + project.name);
    return null;
  }
  if (!response.ok) throw new Error('Cloudflare Pages lookup failed for ' + project.name + ' (' + response.status + ')');
  const data = await response.json();
  if (!data.success || !data.result) throw new Error('Cloudflare Pages returned no project metadata for ' + project.name);
  const projectData = data.result;
  const domains = Array.isArray(projectData.domains) ? projectData.domains.filter((item) => typeof item === 'string') : [];
  const custom = domains.find((domain) => !domain.toLowerCase().endsWith('.pages.dev'));
  const hostname = custom || (projectData.subdomain ? String(projectData.subdomain) + '.pages.dev' : '');
  if (!hostname) throw new Error('Cloudflare Pages project does not expose a domain: ' + project.name);
  return 'https://' + hostname.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

async function cloudflareWorkerApiUrl(workerName) {
  const domainUrl = new URL('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/workers/domains');
  domainUrl.searchParams.set('service', workerName);
  domainUrl.searchParams.set('enabled', 'true');
  const domainsResponse = await fetch(domainUrl, { headers: headersCf });
  if (domainsResponse.ok) {
    const data = await domainsResponse.json();
    const match = (Array.isArray(data.result) ? data.result : []).find((item) =>
      item && item.enabled === true && item.service === workerName && typeof item.hostname === 'string' && item.hostname.length > 0);
    if (match) return 'https://' + String(match.hostname).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  } else if (domainsResponse.status !== 404) {
    console.warn('Custom Worker domain lookup returned HTTP ' + domainsResponse.status + '; checking workers.dev availability.');
  }

  const scriptResponse = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/workers/scripts/' + encodeURIComponent(workerName) + '/subdomain',
    { headers: headersCf }
  );
  if (!scriptResponse.ok) throw new Error('Cloudflare Worker subdomain lookup failed for ' + workerName + ' (' + scriptResponse.status + ')');
  const scriptData = await scriptResponse.json();
  if (!scriptData.success || !scriptData.result) throw new Error('Cloudflare returned no Worker subdomain status for ' + workerName);
  if (scriptData.result.enabled !== true) throw new Error('Worker ' + workerName + ' has no enabled workers.dev route; attach a custom Worker domain or set WORKER_API_DOMAIN_OVERRIDE.');
  const accountResponse = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/workers/subdomain',
    { headers: headersCf }
  );
  if (!accountResponse.ok) throw new Error('Cloudflare account workers.dev subdomain lookup failed (' + accountResponse.status + ')');
  const accountData = await accountResponse.json();
  const subdomain = String(accountData?.result?.subdomain || '').trim();
  if (!accountData.success || !subdomain) throw new Error('Cloudflare account does not expose a workers.dev subdomain.');
  return 'https://' + workerName + '.' + subdomain + '.workers.dev';
}

const varsResponse = await github('/actions/variables?per_page=100');
const variables = Object.fromEntries((varsResponse.variables || []).map((item) => [item.name, String(item.value ?? '')]));
const originalVariables = { ...variables };
const detected = {};
for (const project of projects) {
  try {
    const discovered = await cloudflareProject(project);
    if (discovered) detected[project.key] = discovered;
  } catch (error) {
    if (required.has(project.key)) throw error;
    console.warn('Optional Pages domain could not be detected for ' + project.key + ': ' + String(error.message || error));
  }
}
for (const project of projects) {
  if (!detected[project.key]) continue;
  const override = String(variables[project.overrideKey] || '').trim();
  const publishedUrl = override || detected[project.key];
  let parsed;
  try { parsed = new URL(publishedUrl); } catch { throw new Error('Invalid domain override in GitHub Actions variable ' + project.overrideKey); }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(project.overrideKey + ' must contain an HTTPS origin only.');
  }
  variables[project.variable] = publishedUrl.replace(/\/+$/, '');
  variables[project.appVariable] = publishedUrl.replace(/\/+$/, '');
  console.log(project.key + ' URL synchronized: ' + variables[project.appVariable]);
}

let apiUrl;
try {
  const apiOverride = String(variables.WORKER_API_DOMAIN_OVERRIDE || '').trim();
  apiUrl = apiOverride || await cloudflareWorkerApiUrl(String(process.env.PLATFORM_API_WORKER_NAME || 'hendy-platform-api').trim());
  let parsed;
  try { parsed = new URL(apiUrl); } catch { throw new Error('Invalid Worker API domain override.'); }
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('WORKER_API_DOMAIN_OVERRIDE must contain an HTTPS origin only.');
  }
  variables.VITE_API_BASE_URL = parsed.origin;
  console.log('Worker API URL synchronized: ' + variables.VITE_API_BASE_URL);
} catch (error) {
  if (workerRequired) throw error;
  console.warn('Optional Worker API URL could not be detected: ' + String(error.message || error));
}
const frontendUrls = ['APP_URL','ADMIN_URL','STOREFRONT_URL'].map((name) => variables[name]).filter(Boolean);
variables.CORS_ORIGINS = [...new Set(frontendUrls.map((value) => new URL(value).origin))].join(',');
const updates = ['MINIAPP_PUBLIC_URL','ADMIN_PUBLIC_URL','STOREFRONT_PUBLIC_URL','APP_URL','ADMIN_URL','STOREFRONT_URL','CORS_ORIGINS','VITE_API_BASE_URL']
  .filter((name) => variables[name] !== undefined)
  .map((name) => ({ name, value: variables[name] }));
const existingNames = new Set((varsResponse.variables || []).map((item) => item.name));
const changed = updates.filter((item) => originalVariables[item.name] !== item.value);
for (const item of changed) {
  const suffix = '/actions/variables/' + encodeURIComponent(item.name);
  if (existingNames.has(item.name)) {
    await github(suffix, { method: 'PATCH', body: JSON.stringify(item) });
  } else {
    await github('/actions/variables', { method: 'POST', body: JSON.stringify(item) });
    existingNames.add(item.name);
  }
}
console.log(changed.length
  ? 'Updated GitHub Actions variables: ' + changed.map((item) => item.name).join(', ')
  : 'All discovered URL variables are already synchronized.');

const autoDeployWorkers = String(variables.AUTO_REDEPLOY_WORKERS_AFTER_DOMAIN_SYNC ?? 'true').toLowerCase() !== 'false';
const workerInputsChanged = changed.some((item) => ['APP_URL','ADMIN_URL','STOREFRONT_URL','CORS_ORIGINS'].includes(item.name));
const frontendApiChanged = changed.some((item) => item.name === 'VITE_API_BASE_URL');
if (autoDeployWorkers && workerInputsChanged) {
  await github('/actions/workflows/deploy-workers.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  console.log('Dispatched deploy-workers.yml because public URLs or CORS origins changed.');
} else if (!autoDeployWorkers && workerInputsChanged) {
  console.log('Worker redeployment is disabled by AUTO_REDEPLOY_WORKERS_AFTER_DOMAIN_SYNC.');
}
if (frontendApiChanged) {
  await github('/actions/workflows/deploy-web.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  await github('/actions/workflows/deploy-miniapp.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  console.log('Dispatched Web and Mini App builds because VITE_API_BASE_URL changed.');
}
