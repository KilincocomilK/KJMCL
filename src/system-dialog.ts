import type { SystemDialogApi } from '../shared/types';
import './system-dialog.css';

declare global {
  interface Window {
    kjmclDialog: SystemDialogApi;
  }
}
const api = window.kjmclDialog;
const content = await api.read();
document.title = content.message;
const article = document.querySelector('article')!;
document.querySelector('h1')!.textContent = content.message;
if (content.detail || content.paths?.length) {
  document.querySelector<HTMLElement>('#body')!.hidden = false;
  article.setAttribute('aria-describedby', 'body');
}
if (content.detail) {
  const detail = document.querySelector<HTMLElement>('#detail')!;
  detail.textContent = content.detail;
  detail.hidden = false;
}
if (content.paths?.length) {
  const list = document.querySelector<HTMLElement>('#paths')!;
  list.hidden = false;
  for (const path of content.paths) {
    const item = document.createElement('li');
    item.textContent = path;
    list.append(item);
  }
}
const footer = document.querySelector('footer')!;
const buttons = content.buttons.map((label, index) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = () => api.choose(index);
  return button;
});
const primary = buttons[content.defaultId];
primary.className = 'primary';
footer.append(...buttons.filter((button) => button !== primary), primary);
primary.focus();
document.querySelector<HTMLButtonElement>('#close')!.onclick = () => api.choose(content.cancelId);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    api.choose(content.cancelId);
  }
});
await document.fonts.ready;
api.ready(article.offsetHeight);
