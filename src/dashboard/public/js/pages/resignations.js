import { resignations, bindRequestsPage } from './requests-workflow.js';

export function render() {
  return resignations();
}

export function bind(_data, reload) {
  bindRequestsPage('resignations', document.getElementById('view'), reload);
}
