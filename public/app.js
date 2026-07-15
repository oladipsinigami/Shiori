(function () {
  const logEl = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const healthEl = document.getElementById('health-status');

  const SESSION_KEY = 'shiori_user_id';
  let userId = localStorage.getItem(SESSION_KEY);
  if (!userId) {
    userId = 'web-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(SESSION_KEY, userId);
  }

  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  addBubble(
    'system',
    'Preview mode. For publication, hire Shiori on OKX.AI (ASP #5001).'
  );
  addBubble(
    'agent',
    "Hi — I'm Shiori. Tell me what you love, your mood, and how much time you have."
  );

  async function refreshHealth() {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        healthEl.textContent = 'online · /health ok';
        healthEl.style.color = 'var(--accent-2)';
      } else {
        healthEl.textContent = 'degraded';
        healthEl.style.color = 'var(--accent)';
      }
    } catch {
      healthEl.textContent = 'unreachable';
      healthEl.style.color = 'var(--danger)';
    }
  }
  refreshHealth();
  setInterval(refreshHealth, 60000);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    addBubble('user', message);
    input.value = '';
    sendBtn.disabled = true;
    const thinking = document.createElement('div');
    thinking.className = 'bubble system';
    thinking.textContent = 'Shiori is thinking… (cold start possible)';
    logEl.appendChild(thinking);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message })
      });
      const data = await res.json().catch(() => ({}));
      thinking.remove();
      if (!res.ok) {
        addBubble('agent', data.error || 'Something went wrong. Try again in a moment.');
      } else {
        addBubble('agent', data.response || '(empty response)');
      }
    } catch (err) {
      thinking.remove();
      addBubble('agent', 'Network error — the free host may be waking up. Wait a few seconds and retry.');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-copy');
      const box = document.getElementById(id);
      if (!box) return;
      const text = box.innerText.replace(/^Copy\s*/i, '').trim();
      try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = prev; }, 1200);
      } catch {
        btn.textContent = 'Select & copy';
      }
    });
  });
})();
