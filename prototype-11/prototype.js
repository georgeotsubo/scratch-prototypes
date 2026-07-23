(function () {
  'use strict';

  // ===== State =====
  let animating = false;
  const navStack = ['screen-welcome']; // history; top = current screen

  function currentId() { return navStack[navStack.length - 1]; }

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

  // ===== Welcome screen interactions =====
  const btnSignup = document.getElementById('btn-signup');
  const btnClasspass = document.getElementById('btn-classpass');
  const linkSignin = document.getElementById('link-signin');

  btnClasspass.addEventListener('click', () => pushScreen('screen-classpass'));

  btnSignup.addEventListener('click', () => pushScreen('screen-signup'));

  linkSignin.addEventListener('click', (e) => {
    e.preventDefault();
    pushScreen('screen-login');
  });

  // ===== ClassPass screen interactions =====
  document.getElementById('btn-back-classpass').addEventListener('click', goBack);

  const cpEmail = document.getElementById('cp-email');
  const cpPassword = document.getElementById('cp-password');
  const cpSignin = document.getElementById('btn-cp-signin');

  function updateCpState() {
    const ok = cpEmail.value.trim() && cpPassword.value.length > 0;
    cpSignin.disabled = !ok;
    cpSignin.classList.toggle('btn-disabled', !ok);
  }
  cpEmail.addEventListener('input', updateCpState);
  cpPassword.addEventListener('input', updateCpState);

  cpSignin.addEventListener('click', () => {
    if (cpSignin.disabled) return;
    console.log('[signup] ClassPass sign in submitted');
  });

  // "Forgot password?" (on both the ClassPass sign-in and login screens)
  document.querySelectorAll('.forgot-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      pushScreen('screen-reset');
    });
  });

  // Password visibility toggles (shared across screens).
  // Crossed eye (eye-off) = hidden; open eye = revealed.
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

  // ===== Sign up (Playlist) screen interactions =====
  document.getElementById('btn-back-signup')
    .addEventListener('click', goBack);

  const suFirst = document.getElementById('su-first');
  const suLast = document.getElementById('su-last');
  const suEmail = document.getElementById('su-email');
  const suSubmit = document.getElementById('btn-su-submit');

  function updateSuState() {
    const ok = suFirst.value.trim() && suLast.value.trim() && suEmail.value.trim();
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
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
