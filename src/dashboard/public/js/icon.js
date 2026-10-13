import { ICONS } from './icons.js';

// Iconsax icons, resolved synchronously from a static bundle (see scripts/build-icons.mjs).
export function ic(name, { size = 20, type = 'linear', cls = '' } = {}) {
  const set = ICONS[name];
  if (!set) return '';
  const body = set[type] || set.linear;
  return `<svg class="ix ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// <mx-i name="home" type="bold" size="18"> works in static HTML and in template strings.
class MxIcon extends HTMLElement {
  static observedAttributes = ['name', 'type', 'size'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    this.innerHTML = ic(this.getAttribute('name'), { size: Number(this.getAttribute('size')) || 20, type: this.getAttribute('type') || 'linear' });
  }
}
if (!customElements.get('mx-i')) customElements.define('mx-i', MxIcon);
