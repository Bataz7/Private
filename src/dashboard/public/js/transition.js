// Full-viewport diagonal wipe between dashboard pages.
// The wipe covers the screen, the page is swapped while it is covered, then it exits.
const COVER_MS = 300;
const TOTAL_MS = 640;

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let wipe;
let busy = false;

function ensureWipe() {
  if (wipe) return wipe;
  wipe = document.createElement('div');
  wipe.className = 'wipe';
  wipe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wipe);
  return wipe;
}

const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();

// `prepare` loads the next page (module + data) while the wipe grows, so loading time hides
// behind the animation. `commit` swaps the DOM at the moment the wipe covers the viewport.
export async function transition(prepare, commit) {
  if (busy) return false;
  busy = true;
  const view = document.getElementById('view');
  try {
    if (reduce.matches) {
      commit(await prepare());
      return true;
    }
    const el = ensureWipe();
    el.style.setProperty('--wipe', cssVar('--accent') || '#4f8fdb');
    el.classList.remove('run');
    void el.offsetWidth;
    el.classList.add('run');
    const [prepared] = await Promise.all([Promise.resolve().then(prepare).catch(error => ({ error })), new Promise(resolve => setTimeout(resolve, COVER_MS))]);
    commit(prepared);
    view?.classList.remove('enter');
    void view?.offsetWidth;
    view?.classList.add('enter');
    await new Promise(resolve => setTimeout(resolve, TOTAL_MS - COVER_MS));
    el.classList.remove('run');
    setTimeout(() => view?.classList.remove('enter'), 700);
    return true;
  } finally {
    busy = false;
  }
}

// Same wipe, used to leave the boot screen: the loader is covered, then the app is revealed.
export async function reveal(commit) {
  if (reduce.matches) return commit();
  const el = ensureWipe();
  el.style.setProperty('--wipe', cssVar('--accent') || '#4f8fdb');
  el.classList.remove('run');
  void el.offsetWidth;
  el.classList.add('run');
  await new Promise(resolve => setTimeout(resolve, COVER_MS));
  commit();
  await new Promise(resolve => setTimeout(resolve, TOTAL_MS - COVER_MS));
  el.classList.remove('run');
}
