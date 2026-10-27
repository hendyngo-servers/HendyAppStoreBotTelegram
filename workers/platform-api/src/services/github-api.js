import { encryptGitHubSecret } from './github-crypto.js';

function repositoryPath(env, suffix = '') {
  const owner = String(env.GITHUB_OWNER || '');
  const repo = String(env.GITHUB_REPO || '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error('GitHub owner/repository configuration is invalid');
  }
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

async function githubRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    // Never echo response bodies: GitHub error details can contain sensitive metadata.
    throw new Error(`GitHub API request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function syncGitHubActionsSecrets(env, secrets) {
  if (!env.GITHUB_TOKEN) throw new Error('GitHub token is not configured');
  const publicKey = await githubRequest(repositoryPath(env, '/actions/secrets/public-key'), env.GITHUB_TOKEN);
  if (!publicKey?.key || !publicKey?.key_id) throw new Error('GitHub repository public key is unavailable');
  const results = [];
  for (const [name, value] of Object.entries(secrets)) {
    const encrypted_value = await encryptGitHubSecret(publicKey.key, value);
    await githubRequest(repositoryPath(env, `/actions/secrets/${encodeURIComponent(name)}`), env.GITHUB_TOKEN, {
      method: 'PUT', body: JSON.stringify({ encrypted_value, key_id: publicKey.key_id }),
    });
    results.push(name);
  }
  return results;
}

export async function dispatchGitHubWorkflow(env, workflow, inputs = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('GitHub token is not configured');
  await githubRequest(repositoryPath(env, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`), env.GITHUB_TOKEN, {
    method: 'POST', body: JSON.stringify({ ref: 'main', ...(Object.keys(inputs).length ? { inputs } : {}) }),
  });
  return { workflow, ref: 'main' };
}
