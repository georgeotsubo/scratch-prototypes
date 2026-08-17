(function () {
  'use strict';

  // ===== State =====
  let animating = false;
  const navStack = ['screen-welcome']; // history; top = current screen

  function currentId() { return navStack[navStack.length - 1]; }

  // Basic email shape: something@something.something (no whitespace).
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const ANIM_MS = 380;
  // Release the animation guard after the transition duration. Uses a timeout
  // (not transitionend, which can silently fail to fire in embedded browsers
  // and permanently wedge navigation).
  function releaseAfterAnim(cb) {
    setTimeout(() => { if (cb) cb(); animating = false; }, ANIM_MS + 40);
  }

  // ===== Push navigation =====
  // Forward: incoming slides in from the right, current parallaxes behind.
  function pushScreen(toId) {
    if (animating || toId === currentId()) return;
    const from = document.getElementById(currentId());
    const to = document.getElementById(toId);
    if (!to) return;
    animating = true;

    from.classList.remove('active');
    from.classList.add('behind');
    to.classList.add('active');

    navStack.push(toId);
    // Stack by nav depth so the incoming screen always paints above the
    // outgoing one, regardless of DOM order (kept well below the status bar).
    to.style.zIndex = String(navStack.length);

    releaseAfterAnim();
  }

  // Back: current slides off to the right, previous returns from behind.
  function goBack() {
    if (animating || navStack.length <= 1) return;
    const from = document.getElementById(navStack.pop());
    const to = document.getElementById(currentId());
    if (!to) return;
    animating = true;

    from.classList.remove('active'); // slides back out to the right (default transform)
    to.classList.remove('behind');
    to.classList.add('active');

    releaseAfterAnim(() => { from.style.zIndex = ''; });
  }

  // ===== Home screen → app launch =====
  // Tapping the Playlist icon expands a white tile out of it, fades the
  // springboard away, and reveals the centered mark. After a short hold the
  // tile dissolves onto the welcome photo.
  const homeScreen = document.getElementById('screen-home');
  const launchTile = document.getElementById('launch-tile');
  const statusBar = document.getElementById('global-status-bar');
  const appFrame = document.getElementById('app');
  const LAUNCH_MS = 430;
  const SPLASH_HOLD_MS = 550;
  const SPLASH_FADE_MS = 280;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function revealWelcome() {
    launchTile.classList.add('done');
    appFrame.classList.add('welcome-photo');
    setTimeout(() => {
      launchTile.classList.remove('running', 'expanding', 'show-mark', 'done');
      homeScreen.classList.add('settled');
    }, reduceMotion ? 0 : SPLASH_FADE_MS);
  }

  document.getElementById('btn-launch-playlist').addEventListener('click', () => {
    if (homeScreen.classList.contains('launching')) return;

    if (reduceMotion) {
      homeScreen.classList.add('launching', 'covered', 'settled');
      statusBar.classList.remove('hidden');
      revealWelcome();
      return;
    }

    // Two frames: first paint the fill at icon size, then expand. A single
    // rAF can still apply both classes before paint, which snaps the transform.
    launchTile.classList.add('running');
    void launchTile.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        launchTile.classList.add('expanding');
        homeScreen.classList.add('launching');
      });
    });

    setTimeout(() => {
      homeScreen.classList.add('covered');
      launchTile.classList.add('show-mark');
      statusBar.classList.remove('hidden');
      setTimeout(revealWelcome, SPLASH_HOLD_MS);
    }, LAUNCH_MS);
  });

  // ===== Welcome screen interactions =====
  // "Continue" goes to the shared Playlist/ClassPass sign-in; "Create an
  // account" starts the Playlist sign-up flow.
  document.getElementById('btn-continue')
    .addEventListener('click', () => pushScreen('screen-classpass'));

  document.getElementById('btn-create-account')
    .addEventListener('click', () => pushScreen('screen-signup'));

  // ===== ClassPass screen interactions =====
  document.getElementById('btn-back-classpass').addEventListener('click', goBack);

  const cpEmail = document.getElementById('cp-email');
  const cpPassword = document.getElementById('cp-password');
  const cpSignin = document.getElementById('btn-cp-signin');

  function updateCpState() {
    const ok = EMAIL_RE.test(cpEmail.value.trim()) && cpPassword.value.length > 0;
    cpSignin.disabled = !ok;
  }
  cpEmail.addEventListener('input', updateCpState);
  cpPassword.addEventListener('input', updateCpState);

  cpSignin.addEventListener('click', () => {
    if (cpSignin.disabled) return;
    console.log('[signup] ClassPass sign in submitted');
  });

  // Sign in with Apple — iOS system sheet over a dimmed overlay.
  const siwa = document.getElementById('siwa');
  const siwaClose = document.getElementById('siwa-close');
  function openSiwa() {
    siwa.classList.add('is-open');
    siwa.setAttribute('aria-hidden', 'false');
    siwaClose.focus({ preventScroll: true });
  }
  function closeSiwa(opts) {
    if (!siwa.classList.contains('is-open')) return;
    siwa.classList.remove('is-open');
    siwa.setAttribute('aria-hidden', 'true');
    if (!opts || opts.restoreFocus !== false) {
      document.getElementById('btn-signin-apple').focus({ preventScroll: true });
    }
  }
  document.getElementById('btn-signin-apple').addEventListener('click', (e) => {
    e.preventDefault();
    openSiwa();
  });
  siwaClose.addEventListener('click', closeSiwa);
  document.getElementById('siwa-scrim').addEventListener('click', closeSiwa);
  document.getElementById('siwa-signin').addEventListener('click', () => {
    console.log('[signup] Sign in with Apple submitted');
    enterApp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSiwa();
  });

  // ===== Logged-in tab bar =====
  const appTabs = document.getElementById('app-tabs');
  const tabBar = document.getElementById('app-tab-bar');
  const TAB_IDS = ['home', 'search', 'bookings', 'profile'];

  function setTab(id) {
    if (TAB_IDS.indexOf(id) < 0) return;
    TAB_IDS.forEach((tab) => {
      const pane = document.getElementById('pane-' + tab);
      const btn = tabBar.querySelector('[data-tab="' + tab + '"]');
      const on = tab === id;
      if (pane) pane.classList.toggle('is-active', on);
      if (btn) {
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    });
  }

  function enterApp() {
    appTabs.classList.add('is-open');
    appTabs.setAttribute('aria-hidden', 'false');
    appFrame.classList.add('in-app');
    appFrame.classList.remove('welcome-photo');
    setTab('home');
    closeSiwa({ restoreFocus: false });
  }

  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn || !tabBar.contains(btn)) return;
    setTab(btn.getAttribute('data-tab'));
  });

  // "Forgot password?" (on both the ClassPass sign-in and login screens)
  document.querySelectorAll('.forgot-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      pushScreen('screen-reset');
    });
  });

  // Password visibility toggles (shared across screens).
  // Crossed eye (eye-off / #pl-eye-slash) = hidden; open eye = revealed.
  document.querySelectorAll('.visibility-toggle[data-target]').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const img = btn.querySelector('img');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      if (img) img.src = show ? 'figma-screens/eye.svg' : 'figma-screens/eye-off.svg';
    });
  });

  document.querySelectorAll('.js-password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.pl-field__box');
      const input = box && box.querySelector('.pl-field__input');
      const use = btn.querySelector('use');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      if (use) use.setAttribute('href', show ? '#pl-eye' : '#pl-eye-slash');
    });
  });

  // ===== Sign up (Playlist) screen interactions =====
  document.getElementById('btn-back-signup')
    .addEventListener('click', goBack);

  const suFirst = document.getElementById('su-first');
  const suLast = document.getElementById('su-last');
  const suEmail = document.getElementById('su-email');
  const suSubmit = document.getElementById('btn-su-submit');

  function updateSuState() {
    const ok = suFirst.value.trim() && suLast.value.trim() && EMAIL_RE.test(suEmail.value.trim());
    suSubmit.disabled = !ok;
    suSubmit.classList.toggle('btn-disabled', !ok);
  }
  [suFirst, suLast, suEmail].forEach(el => el.addEventListener('input', updateSuState));

  suSubmit.addEventListener('click', () => {
    if (suSubmit.disabled) return;
    pushScreen('screen-password');
  });

  // ===== Create password screen interactions =====
  document.getElementById('btn-back-password')
    .addEventListener('click', goBack);

  const pwPassword = document.getElementById('pw-password');
  const pwConfirm = document.getElementById('pw-confirm');
  const pwValidation = document.getElementById('pw-validation');
  const pwContinue = document.getElementById('btn-pw-continue');

  // Requirement: at least 8 characters AND a number or symbol.
  function passwordMeetsRules(v) {
    return v.length >= 8 && /[^A-Za-z]/.test(v);
  }

  function updatePasswordState() {
    const valid = passwordMeetsRules(pwPassword.value);
    const matches = pwConfirm.value.length > 0 && pwPassword.value === pwConfirm.value;
    pwValidation.classList.toggle('valid', valid);

    const canContinue = valid && matches;
    pwContinue.disabled = !canContinue;
    pwContinue.classList.toggle('btn-disabled', !canContinue);
  }

  pwPassword.addEventListener('input', updatePasswordState);
  pwConfirm.addEventListener('input', updatePasswordState);

  pwContinue.addEventListener('click', () => {
    if (pwContinue.disabled) return;
    pushScreen('screen-verify');
  });

  // ===== Verify your number screen interactions =====
  document.getElementById('btn-back-verify')
    .addEventListener('click', goBack);

  const vnPhone = document.getElementById('vn-phone');
  const vnContinue = document.getElementById('btn-vn-continue');

  vnPhone.addEventListener('input', () => {
    // Enable once a plausible US number (10 digits) is entered.
    const digits = vnPhone.value.replace(/\D/g, '');
    const ok = digits.length >= 10;
    vnContinue.disabled = !ok;
    vnContinue.classList.toggle('btn-disabled', !ok);
  });

  vnContinue.addEventListener('click', () => {
    if (vnContinue.disabled) return;
    const digits = vnPhone.value.replace(/\D/g, '').slice(0, 10);
    codeSentTo.textContent = 'Code sent to ' + formatPhone(digits) + '.';
    startResendCountdown();
    pushScreen('screen-code');
    // Focus the first code box after the push settles.
    setTimeout(() => codeBoxes[0] && codeBoxes[0].focus(), 420);
  });

  function formatPhone(d) {
    if (d.length < 10) return '+1 ' + d;
    return '+1 ' + d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6, 10);
  }

  // ===== Enter code screen interactions =====
  document.getElementById('btn-back-code')
    .addEventListener('click', goBack);

  const codeSentTo = document.getElementById('code-sent-to');
  const codeBoxes = Array.from(document.querySelectorAll('.code-box'));
  const resendText = document.getElementById('resend-text');
  let resendTimer = null;

  function startResendCountdown() {
    let remaining = 60;
    resendText.classList.remove('active');
    resendText.textContent = 'Resend code in ' + remaining + 's';
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimer);
        resendText.textContent = 'Resend code';
        resendText.classList.add('active');
      } else {
        resendText.textContent = 'Resend code in ' + remaining + 's';
      }
    }, 1000);
  }

  resendText.addEventListener('click', () => {
    if (!resendText.classList.contains('active')) return;
    codeBoxes.forEach(b => (b.value = ''));
    codeBoxes[0].focus();
    startResendCountdown();
  });

  codeBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      if (box.value && i < codeBoxes.length - 1) codeBoxes[i + 1].focus();
      if (codeBoxes.every(b => b.value)) {
        console.log('[signup] Code entered:', codeBoxes.map(b => b.value).join(''));
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        codeBoxes[i - 1].focus();
        codeBoxes[i - 1].value = '';
        e.preventDefault();
      }
    });
  });

  // ===== Reset password screen interactions =====
  document.getElementById('btn-back-reset')
    .addEventListener('click', goBack);

  const rpEmail = document.getElementById('rp-email');
  const rpSubmit = document.getElementById('btn-rp-submit');

  rpEmail.addEventListener('input', () => {
    const ok = EMAIL_RE.test(rpEmail.value.trim());
    rpSubmit.disabled = !ok;
    rpSubmit.classList.toggle('btn-disabled', !ok);
  });

  rpSubmit.addEventListener('click', () => {
    if (rpSubmit.disabled) return;
    console.log('[signup] Reset password email submitted');
  });

  // ===== Log in (Welcome back) screen interactions =====
  document.getElementById('btn-back-login')
    .addEventListener('click', goBack);

  const lgEmail = document.getElementById('lg-email');
  const lgPassword = document.getElementById('lg-password');
  const lgSignin = document.getElementById('btn-lg-signin');

  function updateLoginState() {
    const ok = EMAIL_RE.test(lgEmail.value.trim()) && lgPassword.value.length > 0;
    lgSignin.disabled = !ok;
    lgSignin.classList.toggle('btn-disabled', !ok);
  }
  lgEmail.addEventListener('input', updateLoginState);
  lgPassword.addEventListener('input', updateLoginState);

  lgSignin.addEventListener('click', () => {
    if (lgSignin.disabled) return;
    console.log('[signup] Log in submitted');
  });

  // Prevent dead links from navigating
  document.querySelectorAll('.legal-link').forEach(link => {
    link.addEventListener('click', (e) => e.preventDefault());
  });
})();
