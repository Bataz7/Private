import { esc } from './ui.js';
import { ic } from './icon.js';

// Confirmation dialog for destructive actions. Resolves true only on an explicit confirm.
// `typeToConfirm` forces the user to type a word first (used for irreversible bulk actions).
export function confirmAction({ title, message, confirmText = 'Confirm', danger = true, typeToConfirm = '', details = [] }) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const root = document.createElement('div');
    root.className = 'modal-backdrop confirm-backdrop';
    root.innerHTML = `<section class="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
      <div class="confirm-head"><span class="confirm-icon ${danger ? 'danger' : ''}">${ic(danger ? 'warning-2' : 'info-circle', { size: 24 })}</span><div><h2 id="confirmTitle">${esc(title)}</h2><p id="confirmMessage">${esc(message)}</p></div></div>
      ${details.length ? `<ul class="confirm-list">${details.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
      ${typeToConfirm ? `<label class="confirm-type"><span>Type <b>${esc(typeToConfirm)}</b> to continue</span><input autocomplete="off" spellcheck="false" data-confirm-input></label>` : ''}
      <div class="confirm-actions"><button type="button" class="secondary" data-confirm-cancel>Cancel</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-confirm-ok ${typeToConfirm ? 'disabled' : ''}>${esc(confirmText)}</button></div>
    </section>`;
    document.body.appendChild(root);
    const ok = root.querySelector('[data-confirm-ok]');
    const input = root.querySelector('[data-confirm-input]');
    const close = value => { root.remove(); document.removeEventListener('keydown', onKey, true); previous?.focus?.(); resolve(value); };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
      if (event.key === 'Tab') {
        const focusable = [...root.querySelectorAll('button:not(:disabled), input')];
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', event => { if (event.target === root) close(false); });
    root.querySelector('[data-confirm-cancel]').addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    input?.addEventListener('input', () => { ok.disabled = input.value.trim() !== typeToConfirm; });
    input?.addEventListener('keydown', event => { if (event.key === 'Enter' && !ok.disabled) close(true); });
    (input || root.querySelector('[data-confirm-cancel]')).focus();
  });
}
