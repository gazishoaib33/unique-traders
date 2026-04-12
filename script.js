/* ── UNIQUE TRADERS · script.js ─────────────────────────────── */

// ── Language Toggle ────────────────────────────────────────────
let isBn = false;

function toggleLang() {
  isBn = !isBn;
  const btn = document.getElementById('langBtn');

  // Toggle button label
  btn.textContent = isBn ? 'English' : 'বাংলা';

  // Toggle all [data-en] / [data-bn] elements
  document.querySelectorAll('[data-en]').forEach(el => {
    if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'P' || el.tagName === 'H4' || el.tagName === 'SMALL') {
      el.textContent = isBn ? el.dataset.bn : el.dataset.en;
    }
  });

  // Toggle .en-text / .bn-text visibility
  document.querySelectorAll('.en-text').forEach(el => el.classList.toggle('hidden', isBn));
  document.querySelectorAll('.bn-text').forEach(el => el.classList.toggle('hidden', !isBn));

  // Switch body font weight for Bengali readability
  document.body.style.fontFamily = isBn
    ? "'Noto Sans Bengali', sans-serif"
    : "'Barlow', sans-serif";
}

// ── Hamburger / Mobile Menu ────────────────────────────────────
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

// ── Sticky Navbar shadow on scroll ────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    navbar.style.background = 'rgba(10,6,2,0.98)';
    navbar.style.boxShadow = '0 2px 24px rgba(0,0,0,0.5)';
  } else {
    navbar.style.background = 'rgba(10,6,2,0.92)';
    navbar.style.boxShadow = 'none';
  }
}, { passive: true });

// ── Smooth active link highlight ──────────────────────────────
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a, .mobile-menu a');

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navAnchors.forEach(a => {
        a.style.color = a.getAttribute('href') === '#' + entry.target.id
          ? 'var(--gold)'
          : '';
      });
    }
  });
}, { threshold: 0.4 });

sections.forEach(s => observer.observe(s));

// ── Reveal cards on scroll ────────────────────────────────────
const revealEls = document.querySelectorAll('.product-card, .contact-card, .av-card');

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

revealEls.forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  revealObserver.observe(el);
});

// ── Phone number click tracking (optional analytics hook) ─────
document.querySelectorAll('a[href^="tel"]').forEach(link => {
  link.addEventListener('click', () => {
    console.log('📞 Call initiated:', link.href);
    // You can add Google Analytics / Facebook Pixel event here later
  });
});

// ── Close mobile menu on outside click ────────────────────────
document.addEventListener('click', e => {
  const menu = document.getElementById('mobileMenu');
  const hamburger = document.getElementById('hamburger');
  if (menu.classList.contains('open') && !menu.contains(e.target) && !hamburger.contains(e.target)) {
    menu.classList.remove('open');
  }
});
