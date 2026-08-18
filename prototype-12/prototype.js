(function () {
  'use strict';

  // ===== State =====
  let animating = false;
  const navStack = ['screen-welcome']; // history; top = current screen

  function currentId() { return navStack[navStack.length - 1]; }

  // Off-screen views stay in the DOM (for the slide transition) but must not
  // be tabbable. Focusing a translated field makes the browser scroll it into
  // view and the frame appears stuck between two screens.
  function syncScreenInert() {
    const current = currentId();
    const home = document.getElementById('screen-home');
    const homeShowing = home && !home.classList.contains('launching') && !home.classList.contains('settled');
    document.querySelectorAll('#app > .screen').forEach((el) => {
      const on = homeShowing ? el.id === 'screen-home' : el.id === current;
      el.toggleAttribute('inert', !on);
    });
  }

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
    syncScreenInert();

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
    syncScreenInert();

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
      syncScreenInert();
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
        syncScreenInert();
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
    enterApp();
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

  // Sign in with Google — iOS ASWebAuthenticationSession alert, then
  // the accounts.google.com choose-account sheet.
  const gauth = document.getElementById('gauth');
  const gauthCancel = document.getElementById('gauth-cancel');
  const gauthSheetClose = document.getElementById('gauth-sheet-close');
  const gauthAlert = gauth.querySelector('.gauth-alert');
  const gauthSheet = document.getElementById('gauth-sheet');
  const gauthStepChoose = document.getElementById('gauth-step-choose');
  const gauthStepResume = document.getElementById('gauth-step-resume');
  function setGauthStep(step) {
    const resume = step === 'resume';
    gauth.classList.toggle('is-resume', resume);
    gauthStepChoose.classList.toggle('is-active', !resume);
    gauthStepResume.classList.toggle('is-active', resume);
    gauthStepChoose.setAttribute('aria-hidden', resume ? 'true' : 'false');
    gauthStepResume.setAttribute('aria-hidden', resume ? 'false' : 'true');
    gauthSheet.setAttribute('aria-labelledby', resume ? 'gauth-resume-title' : 'gauth-sheet-title');
  }
  function openGauth() {
    gauth.classList.add('is-open', 'is-alert');
    gauth.classList.remove('is-sheet', 'is-resume');
    gauth.setAttribute('aria-hidden', 'false');
    gauthAlert.removeAttribute('aria-hidden');
    gauthSheet.setAttribute('aria-hidden', 'true');
    setGauthStep('choose');
    gauthCancel.focus({ preventScroll: true });
  }
  function showGauthSheet() {
    gauth.classList.add('is-open', 'is-sheet');
    gauth.classList.remove('is-alert');
    gauth.setAttribute('aria-hidden', 'false');
    gauthAlert.setAttribute('aria-hidden', 'true');
    gauthSheet.removeAttribute('aria-hidden');
    setGauthStep('choose');
    gauthSheetClose.focus({ preventScroll: true });
  }
  function closeGauth(opts) {
    if (!gauth.classList.contains('is-open')) return;
    gauth.classList.remove('is-open', 'is-alert', 'is-sheet', 'is-resume');
    gauth.setAttribute('aria-hidden', 'true');
    setGauthStep('choose');
    if (!opts || opts.restoreFocus !== false) {
      document.getElementById('btn-signin-google').focus({ preventScroll: true });
    }
  }
  document.getElementById('btn-signin-google').addEventListener('click', (e) => {
    e.preventDefault();
    openGauth();
  });
  gauthCancel.addEventListener('click', closeGauth);
  document.getElementById('gauth-scrim').addEventListener('click', closeGauth);
  document.getElementById('gauth-continue').addEventListener('click', () => {
    showGauthSheet();
  });
  gauthSheetClose.addEventListener('click', closeGauth);
  document.getElementById('gauth-pick-account').addEventListener('click', () => {
    setGauthStep('resume');
  });
  document.getElementById('gauth-chip').addEventListener('click', () => {
    setGauthStep('choose');
  });
  document.getElementById('gauth-resume-cancel').addEventListener('click', closeGauth);
  document.getElementById('gauth-resume-continue').addEventListener('click', () => {
    console.log('[signup] Sign in with Google submitted');
    enterApp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (gauth.classList.contains('is-open')) closeGauth();
    else if (signout.classList.contains('is-open')) closeSignout();
    else if (loc.classList.contains('is-open')) finishLocPrompt();
    else closeSiwa();
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
    closeGauth({ restoreFocus: false });
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
  document.getElementById('btn-signup-signin')
    .addEventListener('click', () => pushScreen('screen-classpass'));

  const suFirst = document.getElementById('su-first');
  const suLast = document.getElementById('su-last');
  const suEmail = document.getElementById('su-email');
  const suSubmit = document.getElementById('btn-su-submit');

  function updateSuState() {
    const ok = suFirst.value.trim() && suLast.value.trim() && EMAIL_RE.test(suEmail.value.trim());
    suSubmit.disabled = !ok;
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
  const pwConfirmField = document.getElementById('pw-confirm-field');
  const pwValidation = document.getElementById('pw-validation');
  const pwHintIcon = document.getElementById('pw-hint-icon');
  const pwContinue = document.getElementById('btn-pw-continue');
  const PW_HINT = {
    default: '../design-system/assets/validation_default.svg',
    error: '../design-system/assets/validation_error.svg',
    valid: '../design-system/assets/validation_indicator.svg'
  };

  // Requirement: at least 8 characters AND a number or symbol.
  function passwordMeetsRules(v) {
    return v.length >= 8 && /[^A-Za-z]/.test(v);
  }

  function updatePasswordState() {
    const value = pwPassword.value;
    const valid = passwordMeetsRules(value);
    const state = !value ? 'default' : (valid ? 'valid' : 'error');
    pwValidation.dataset.state = state;
    pwHintIcon.src = PW_HINT[state];

    const matches = pwConfirm.value.length > 0 && value === pwConfirm.value;
    pwConfirmField.classList.toggle('is-error', pwConfirm.value.length > 0 && !matches);

    pwContinue.disabled = !(valid && matches);
  }

  pwPassword.addEventListener('input', updatePasswordState);
  pwConfirm.addEventListener('input', updatePasswordState);

  pwContinue.addEventListener('click', () => {
    if (pwContinue.disabled) return;
    openLocPrompt();
  });

  // Location prompt over Create a password (12901:344255),
  // then the iOS permission alert (12901:344459) after Enable location.
  const loc = document.getElementById('loc');
  const locDialog = loc.querySelector('.loc-dialog');
  const locEnable = document.getElementById('loc-enable');
  const locNative = document.getElementById('loc-native');
  const locAllowOnce = document.getElementById('loc-allow-once');
  function openLocPrompt() {
    loc.classList.add('is-open');
    loc.classList.remove('is-native');
    loc.setAttribute('aria-hidden', 'false');
    locNative.setAttribute('aria-hidden', 'true');
    locDialog.removeAttribute('inert');
    document.getElementById('screen-password').setAttribute('inert', '');
    locEnable.focus({ preventScroll: true });
  }
  function openLocNative() {
    loc.classList.add('is-native');
    locNative.setAttribute('aria-hidden', 'false');
    locDialog.setAttribute('inert', '');
    locAllowOnce.focus({ preventScroll: true });
  }
  function finishLocPrompt() {
    if (!loc.classList.contains('is-open')) return;
    loc.classList.remove('is-open', 'is-native');
    loc.setAttribute('aria-hidden', 'true');
    locNative.setAttribute('aria-hidden', 'true');
    locDialog.removeAttribute('inert');
    pushScreen('screen-verify');
  }
  locEnable.addEventListener('click', openLocNative);
  document.getElementById('loc-later').addEventListener('click', finishLocPrompt);
  locAllowOnce.addEventListener('click', finishLocPrompt);
  document.getElementById('loc-allow-while').addEventListener('click', finishLocPrompt);
  document.getElementById('loc-dont-allow').addEventListener('click', finishLocPrompt);

  // Sign out confirm over Verify your number (11381:41894).
  const signout = document.getElementById('signout');
  const signoutCancel = document.getElementById('signout-cancel');
  function openSignout() {
    signout.classList.add('is-open');
    signout.setAttribute('aria-hidden', 'false');
    document.getElementById('screen-verify').setAttribute('inert', '');
    signoutCancel.focus({ preventScroll: true });
  }
  function closeSignout() {
    if (!signout.classList.contains('is-open')) return;
    signout.classList.remove('is-open');
    signout.setAttribute('aria-hidden', 'true');
    document.getElementById('screen-verify').removeAttribute('inert');
    document.getElementById('btn-back-verify').focus({ preventScroll: true });
  }
  function signOutToWelcome() {
    if (animating) return;
    closeSignout();
    const from = document.getElementById(currentId());
    while (navStack.length > 1) navStack.pop();
    const to = document.getElementById('screen-welcome');
    animating = true;
    document.querySelectorAll('#app > .screen').forEach((el) => {
      if (el !== from && el !== to) {
        el.classList.remove('active', 'behind');
        el.style.zIndex = '';
      }
    });
    from.classList.remove('active');
    to.classList.remove('behind');
    to.classList.add('active');
    syncScreenInert();
    releaseAfterAnim(() => { from.style.zIndex = ''; });
  }
  document.getElementById('btn-back-verify').addEventListener('click', openSignout);
  signoutCancel.addEventListener('click', closeSignout);
  document.getElementById('signout-scrim').addEventListener('click', closeSignout);
  document.getElementById('signout-confirm').addEventListener('click', signOutToWelcome);

  const vnPhone = document.getElementById('vn-phone');
  const vnContinue = document.getElementById('btn-vn-continue');

  vnPhone.addEventListener('input', () => {
    const digits = vnPhone.value.replace(/\D/g, '');
    vnContinue.disabled = digits.length < 10;
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

  function checkCodeComplete() {
    if (codeBoxes.every((b) => b.value)) enterApp();
  }

  function typeCodeDigit(digit) {
    const target = codeBoxes.find((b) => !b.value);
    if (!target) return;
    target.value = digit;
    const next = codeBoxes[codeBoxes.indexOf(target) + 1];
    (next || target).focus({ preventScroll: true });
    checkCodeComplete();
  }

  function deleteCodeDigit() {
    const focused = codeBoxes.find((b) => b === document.activeElement);
    if (focused && focused.value) {
      focused.value = '';
      focused.focus({ preventScroll: true });
      return;
    }
    const lastFilled = [...codeBoxes].reverse().find((b) => b.value);
    if (!lastFilled) {
      codeBoxes[0].focus({ preventScroll: true });
      return;
    }
    lastFilled.value = '';
    lastFilled.focus({ preventScroll: true });
  }

  resendText.addEventListener('click', () => {
    if (!resendText.classList.contains('active')) return;
    codeBoxes.forEach((b) => (b.value = ''));
    codeBoxes[0].focus({ preventScroll: true });
    startResendCountdown();
  });

  document.getElementById('code-keyboard').addEventListener('click', (e) => {
    const key = e.target.closest('.code-keyboard__key');
    if (!key) return;
    if (key.hasAttribute('data-delete')) deleteCodeDigit();
    else if (key.dataset.digit) typeCodeDigit(key.dataset.digit);
  });

  codeBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      if (box.value && i < codeBoxes.length - 1) codeBoxes[i + 1].focus({ preventScroll: true });
      checkCodeComplete();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        typeCodeDigit(e.key);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        deleteCodeDigit();
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
    enterApp();
  });

  // Prevent dead links from navigating
  document.querySelectorAll('.legal-link').forEach(link => {
    link.addEventListener('click', (e) => e.preventDefault());
  });

  syncScreenInert();
})();
