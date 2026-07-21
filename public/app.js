(function () {
  const logEl = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const healthEl = document.getElementById('health-status');
  const walletBtn = document.getElementById('wallet-btn');
  const walletRow = document.getElementById('wallet-row');
  const walletAddr = document.getElementById('wallet-addr');
  const paymentNote = document.getElementById('payment-note');
  const publicUrlEl = document.getElementById('public-url');

  const SESSION_KEY = 'shiori_user_id';
  let userId = localStorage.getItem(SESSION_KEY);
  if (!userId) {
    userId = 'web-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(SESSION_KEY, userId);
  }

  let walletAddress = null;

  function addBubble(role, text, isHtml) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    if (isHtml) { div.innerHTML = text; }
    else { div.textContent = text; }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  addBubble('agent', "Hi — I'm Shiori. 0.01 USD₮0 per request on X Layer (x402 exact via OKX Payment SDK). Hire agent #5001 on OKX.AI, or connect a wallet for the site demo.");

  async function refreshHealth() {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      const data = await res.json();
      // Drive the footer link from the server's PUBLIC_BASE_URL (via /health)
      // so it always reflects the deployed domain instead of a hardcoded value.
      if (data.publicUrl && publicUrlEl) {
        const clean = data.publicUrl.replace(/\/$/, '');
        publicUrlEl.href = clean;
        publicUrlEl.textContent = clean.replace(/^https?:\/\//, '');
      }
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

  window.connectWallet = async function connectWallet() {
    if (!window.ethereum) {
      addBubble('system', 'Please install MetaMask to use this app.');
      return;
    }
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      walletAddress = accounts[0];
      walletBtn.textContent = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
      walletBtn.classList.add('connected');
      walletRow.style.display = 'flex';
      walletAddr.textContent = walletAddress;
      paymentNote.textContent = 'Wallet connected! Type a message and send.';
      addBubble('system', 'Wallet connected: ' + walletAddress);
    } catch {
      addBubble('system', 'Wallet connection cancelled.');
    }
  };

  async function switchToXLayer() {
    if (!window.ethereum) return false;
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] });
      return true;
    } catch (e) {
      if (e.code === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xc4',
              chainName: 'XLayer',
              nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
              rpcUrls: ['https://xlayerrpc.okx.com'],
              blockExplorerUrls: ['https://www.okx.com/explorer/xlayer'],
            }],
          });
          return true;
        } catch { return false; }
      }
      return false;
    }
  }

  function waitForTx(txHash) {
    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const receipt = await ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          });
          if (receipt && receipt.blockNumber) { resolve(receipt); }
          else { setTimeout(check, 2000); }
        } catch { setTimeout(check, 2000); }
      };
      check();
    });
  }

  async function payAndRetry(message) {
    if (!window.ethereum || !walletAddress) {
      addBubble('system', 'Wallet not connected. Please connect first.');
      return;
    }

    addBubble('system', 'Switching MetaMask to XLayer network...');
    const onXLayer = await switchToXLayer();
    if (!onXLayer) {
      addBubble('system', 'Please switch to XLayer network in MetaMask manually and try again.');
      return;
    }

    // Official OKX path is gasless EIP-3009 (exact) via the OKX Payment SDK /
    // onchainos payment quote·pay — not a raw ERC-20 transfer. The site still
    // offers a simple USD₮0 transfer for demos; prefer hiring agent #5001 on OKX.AI.
    const token = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
    const payTo = '0xa2fbc18fd6306d84566f85edd6912fc8f91af33c';
    const amount = '10000';

    try {
      addBubble('system', 'Sending 0.01 USD₮0 to Shiori on XLayer (demo transfer)...');
      addBubble('system', 'Tip: full x402 exact payments work best via OKX.AI (agent #5001).');

      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: walletAddress,
          to: token,
          data: '0xa9059cbb' +
            payTo.slice(2).padStart(64, '0') +
            BigInt(amount).toString(16).padStart(64, '0'),
        }],
      });

      addBubble('system', 'Tx submitted: ' + txHash.slice(0, 10) + '... Waiting for confirmation...');
      await waitForTx(txHash);
      addBubble('system', 'On-chain transfer confirmed. Retrying chat with payment proof...');

      const paymentHeader = btoa(JSON.stringify({ txHash, payer: walletAddress }));
      await doChat(message, paymentHeader);
    } catch (e) {
      addBubble('system', 'Payment failed: ' + (e.message || 'User rejected'));
    }
  }

  async function doChat(message, xPaymentHeader) {
    const headers = { 'Content-Type': 'application/json' };
    if (xPaymentHeader) { headers['x-payment'] = xPaymentHeader; }

    const res = await fetch('/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, message }),
    });

    if (res.status === 402) {
      const data = await res.json().catch(() => ({}));
      addBubble('system', 'Payment required — 0.01 USD₮0 on X Layer (x402)');
      const payDiv = addBubble('system', '💳 Click to pay 0.01 USD₮0 and continue', true);
      payDiv.style.cursor = 'pointer';
      payDiv.style.border = '1px solid var(--accent)';
      payDiv.style.padding = '0.75rem 1rem';
      payDiv.onclick = async () => {
        payDiv.remove();
        await payAndRetry(message);
      };
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      addBubble('agent', data.detail || data.error || 'Something went wrong.');
      return;
    }
    addBubble('agent', data.response || '(empty response)');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    if (!walletAddress) {
      addBubble('system', 'Please connect your wallet first.');
      return;
    }

    addBubble('user', message);
    input.value = '';
    sendBtn.disabled = true;
    const thinking = document.createElement('div');
    thinking.className = 'bubble system';
    thinking.textContent = 'Shiori is thinking...';
    logEl.appendChild(thinking);

    try {
      await doChat(message);
    } catch (err) {
      thinking.remove();
      addBubble('agent', 'Network error — the free host may be waking up. Retry in a few seconds.');
    } finally {
      const t = logEl.querySelector('.bubble.system:last-child');
      if (t && t.textContent.includes('thinking')) t.remove();
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

  /* ===================== Cinematic scene switcher ===================== */
  // CSS owns the visuals; JS just flips classes/attributes:
  //   body[data-scene="N"]  -> content theming (scene 2 = Night City dark)
  //   .scene-video.is-active -> which clip is visible (1000ms crossfade)
  //   body.scene-sweeping    -> fires the one-shot liquid-glass light-sweep
  const SCENE_FADE = 1000;
  const videos = Array.from(document.querySelectorAll('[data-scene-video]'));
  const moodBtns = Array.from(document.querySelectorAll('[data-scene-btn]'));
  let activeScene = 0;
  let isTransitioning = false;

  function tryPlay(video) {
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked; ignore */ });
  }

  function setScene(next) {
    if (next === activeScene || isTransitioning) return;
    if (next < 0 || next >= videos.length) return;
    isTransitioning = true;

    const incoming = videos[next];
    if (incoming) {
      if (incoming.preload === 'none') { incoming.preload = 'auto'; incoming.load(); }
      tryPlay(incoming);
    }

    videos.forEach((v, i) => v.classList.toggle('is-active', i === next));
    moodBtns.forEach((b, i) => {
      const on = i === next;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.body.setAttribute('data-scene', String(next));

    // Fire the signature light-sweep across all glass panels, in sync.
    document.body.classList.remove('scene-sweeping');
    void document.body.offsetWidth; // reflow so the animation can restart
    document.body.classList.add('scene-sweeping');

    activeScene = next;
    setTimeout(() => {
      isTransitioning = false;
      document.body.classList.remove('scene-sweeping');
    }, SCENE_FADE);
  }

  moodBtns.forEach((btn) => {
    btn.addEventListener('click', () => setScene(Number(btn.getAttribute('data-scene-btn'))));
  });

  // Kick the first clip once the page is interactive (some browsers need a nudge).
  tryPlay(videos[0]);

  /* ===================== Mobile menu ===================== */
  const menuToggle = document.getElementById('menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  function openMenu() {
    if (!mobileMenu) return;
    mobileMenu.hidden = false;
    // next frame so the [hidden]->visible transition animates
    requestAnimationFrame(() => document.body.classList.add('menu-open'));
    menuToggle && menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle && menuToggle.setAttribute('aria-label', 'Close menu');
  }
  function closeMenu() {
    document.body.classList.remove('menu-open');
    menuToggle && menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle && menuToggle.setAttribute('aria-label', 'Open menu');
    setTimeout(() => { if (mobileMenu && !document.body.classList.contains('menu-open')) mobileMenu.hidden = true; }, 500);
  }
  function toggleMenu() {
    if (document.body.classList.contains('menu-open')) closeMenu(); else openMenu();
  }

  if (menuToggle) menuToggle.addEventListener('click', toggleMenu);
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a, button').forEach((el) => el.addEventListener('click', closeMenu));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) closeMenu();
  });
})();
