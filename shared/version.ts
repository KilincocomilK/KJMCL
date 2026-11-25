import { author, license, repository, version } from '../package.json';
export const VERSION = version;
export const AUTHOR = author;
export const LICENSE = license;
export const PROJECT_URL = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
