import { gt, parse } from 'semver';
import { z } from 'zod';
import { PROJECT_URL } from '../../shared/version';
import type { LauncherUpdate } from '../../shared/types';
import type { Network } from './network';

const releases = 'https://api.github.com/repos' + new URL(PROJECT_URL).pathname + '/releases';
const releaseSchema = z.object({
  tag_name: z.string().trim().min(1).max(128),
  draft: z.boolean(),
  prerelease: z.boolean(),
});
const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
const feedRelease = z.object({
  version: z.string().trim().min(1).max(128),
  releaseUrl: httpsUrl.optional(),
});

export class LauncherUpdates {
  state: LauncherUpdate = { status: 'idle' };
  private pending?: Promise<void>;
  private page?: string;
  private dismissedVersion?: string;

  constructor(
    private current: string,
    private net: Pick<Network, 'response'>,
    private changed: () => void,
    private source = 'github',
  ) {}

  get releaseUrl() {
    return (this.state.status === 'available' && this.page) || PROJECT_URL + '/releases';
  }

  enter() {
    this.dismissedVersion = undefined;
    return this.check();
  }

  dismiss(version: string) {
    if (this.state.version !== version) return;
    this.dismissedVersion = version;
    this.state = { ...this.state, notificationDismissed: true };
    this.changed();
  }

  check() {
    if (this.pending) return this.pending;
    this.state = { ...this.state, status: 'checking' };
    this.changed();
    this.pending = this.read()
      .catch((): LauncherUpdate => ({ status: 'unavailable', issue: 'network' }))
      .then((result) => {
        this.state = {
          ...result,
          checkedAt: Date.now(),
          notificationDismissed: !!result.version && result.version === this.dismissedVersion,
        };
        this.changed();
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async read(): Promise<LauncherUpdate> {
    this.page = undefined;
    if (this.source !== 'github') {
      if (!httpsUrl.safeParse(this.source).success)
        return { status: 'unavailable', issue: 'release' };
      const response = await this.net.response(this.source, { redirect: 'error' }, false, 12000);
      if (!response.ok) {
        await response.body?.cancel();
        return { status: 'unavailable', issue: 'network' };
      }
      const release = feedRelease.safeParse(await response.json());
      if (!release.success) return { status: 'unavailable', issue: 'release' };
      this.page = release.data.releaseUrl;
      return this.compare(release.data.version);
    }
    const headers = { Accept: 'application/vnd.github+json' };
    const get = (suffix: string) =>
      this.net.response(releases + suffix, { headers, redirect: 'error' }, false, 12000);
    let response = await get('/latest');
    if (response.status === 404) {
      await response.body?.cancel();
      // GitHub also returns 404 for an accessible repository without a stable release.
      response = await get('?per_page=1');
      if (response.ok) {
        await response.body?.cancel();
        return { status: 'unpublished' };
      }
    }
    if (!response.ok) {
      await response.body?.cancel();
      const limited =
        response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0';
      const access = [401, 403, 404].includes(response.status);
      return {
        status: 'unavailable',
        issue: limited ? 'rate-limit' : access ? 'access' : 'network',
      };
    }
    const release = releaseSchema.safeParse(await response.json());
    if (!release.success || release.data.draft || release.data.prerelease)
      return { status: 'unavailable', issue: 'release' };
    this.page = PROJECT_URL + '/releases/tag/' + encodeURIComponent(release.data.tag_name);
    return this.compare(release.data.tag_name);
  }

  private compare(version: string): LauncherUpdate {
    const latest = parse(version),
      current = parse(this.current);
    if (!latest || !current || latest.prerelease.length)
      return { status: 'unavailable', issue: 'release' };
    return { status: gt(latest, current) ? 'available' : 'current', version: latest.version };
  }
}
