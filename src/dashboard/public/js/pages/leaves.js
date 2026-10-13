import { leaves, bindRequestsPage } from './requests-workflow.js';

export function render() {
  return leaves();
}

export function bind(_data, reload) {
  bindRequestsPage('leaves', document.getElementById('view'), reload);
}
