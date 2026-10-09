// ===== REALTIME CHAT =====
(function () {
  if (typeof USER_ID === 'undefined' || typeof CONV_ID === 'undefined') return;

  const socket = window._mainSocket || (window._mainSocket = io());
  const messagesWrap = document.getElementById('messagesWrap');
  const messageForm  = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  let typingTimer;
  let isSending = false; // prevent double send

  // Join rooms
  socket.emit('join', USER_ID);
  if (CONV_ID) socket.emit('joinConversation', CONV_ID);

  // Scroll to bottom on page load
  scrollToBottom(false);

  // ===== SEND MESSAGE =====
  function sendMessage() {
    if (isSending) return;
    const content = messageInput.value.trim();
    if (!content || !CONV_ID) return;

    isSending = true;

    // Optimistic UI — show immediately
    const tempId = 'temp_' + Date.now();
    appendMessage({
      _id: tempId,
      sender: { _id: USER_ID },
      content,
      createdAt: new Date().toISOString()
    }, true);

    messageInput.value = '';
    scrollToBottom(true);

    // Send to server via socket
    socket.emit('sendMessage', {
      conversationId: CONV_ID,
      senderId: USER_ID,
      receiverId: OTHER_USER_ID,
      content,
      tempId
    });

    socket.emit('stopTyping', { conversationId: CONV_ID, userId: USER_ID });

    setTimeout(() => { isSending = false; }, 300);
  }

  if (messageForm) {
    messageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage();
    });
  }

  if (messageInput) {
    // Enter to send (Shift+Enter = new line not needed in single-line input)
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Typing indicator
    messageInput.addEventListener('input', () => {
      if (!CONV_ID) return;
      socket.emit('typing', { conversationId: CONV_ID, userId: USER_ID });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        socket.emit('stopTyping', { conversationId: CONV_ID, userId: USER_ID });
      }, 1500);
    });
  }

  // ===== RECEIVE NEW MESSAGE FROM SERVER =====
  socket.on('newMessage', (msg) => {
    if (!msg || !msg.sender) return;

    const senderId = msg.sender._id ? msg.sender._id.toString() : msg.sender.toString();

    // If it's OWN message — remove optimistic temp bubble, replace with real one
    if (senderId === USER_ID.toString()) {
      // Remove last temp message
      const tempMsg = messagesWrap?.querySelector('[data-msg-id^="temp_"]');
      if (tempMsg) tempMsg.remove();
      // Append confirmed message
      appendMessage(msg, true);
    } else {
      // Other user's message
      appendMessage(msg, false);
    }

    scrollToBottom(true);

    // Update conversation sidebar last message
    updateSidebarLastMsg(msg.content);
  });

  // ===== MESSAGE ERROR =====
  socket.on('messageError', (data) => {
    // Remove failed temp message
    const tempMsg = messagesWrap?.querySelector('[data-msg-id^="temp_"]');
    if (tempMsg) {
      tempMsg.querySelector('.message-text').textContent += ' ⚠️ Failed';
      tempMsg.style.opacity = '0.5';
    }
    isSending = false;
  });

  // ===== CONVERSATION UPDATED (sidebar) =====
  socket.on('conversationUpdated', (data) => {
    updateSidebarLastMsg(data.lastMessage);
  });

  // ===== TYPING INDICATOR =====
  const typingEl = document.getElementById('typingIndicator');
  socket.on('userTyping', (data) => {
    if (data.userId !== USER_ID && typingEl) {
      typingEl.style.display = 'flex';
      scrollToBottom(false);
    }
  });
  socket.on('userStopTyping', (data) => {
    if (data.userId !== USER_ID && typingEl) {
      typingEl.style.display = 'none';
    }
  });

  // ===== APPEND MESSAGE =====
  function appendMessage(msg, isOwn) {
    if (!messagesWrap) return;

    const senderId = msg.sender?._id?.toString() || msg.sender?.toString() || '';

    const avatarSrc = isOwn
      ? (window.__ownAvatar || (typeof OTHER_USER_AVATAR !== 'undefined' ? '' : '/images/default-avatar.png'))
      : (msg.sender?.googleAvatar || (senderId ? `/avatar/${senderId}` : '/images/default-avatar.png'));

    const time = new Date(msg.createdAt).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit'
    });

    const row = document.createElement('div');
    row.className = `message-row ${isOwn ? 'message-own' : 'message-other'}`;
    row.setAttribute('data-msg-id', msg._id || '');

    row.innerHTML = `
      ${!isOwn
        ? `<img src="${escapeHtml(avatarSrc)}" class="msg-avatar" onerror="this.src='/images/default-avatar.png'">`
        : ''
      }
      <div class="message-bubble">
        <div class="message-text">${escapeHtml(msg.content)}</div>
        <div class="message-time">${time}</div>
      </div>
    `;

    messagesWrap.appendChild(row);
  }

  // ===== UPDATE SIDEBAR LAST MSG =====
  function updateSidebarLastMsg(content) {
    if (!CONV_ID) return;
    const convItem = document.querySelector(`.conv-item[href="/messages/${CONV_ID}"] .conv-last-msg`);
    if (convItem && content) {
      convItem.textContent = content.length > 30 ? content.substring(0, 30) + '...' : content;
    }
  }

  // ===== SCROLL TO BOTTOM =====
  function scrollToBottom(smooth) {
    if (!messagesWrap) return;
    messagesWrap.scrollTo({
      top: messagesWrap.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  // ===== ESCAPE HTML =====
  function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(text));
    return d.innerHTML;
  }

  // ===== SEARCH CONVERSATIONS =====
  const convSearch = document.getElementById('convSearchInput');
  if (convSearch) {
    convSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('.conv-item').forEach(item => {
        const name = item.getAttribute('data-name') || '';
        item.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });
  }

  // ===== AUTO SCROLL ON FOCUS (Mobile virtual keyboard) =====
  if (messageInput) {
    messageInput.addEventListener('focus', () => {
      setTimeout(() => scrollToBottom(true), 250);
    });
  }

  // ===== AUTO-SEND INIT MESSAGE (from "message about project" flow) =====
  if (messageInput && messageInput.value.trim()) {
    setTimeout(sendMessage, 600);
  }

  // ===== INSTANT MOBILE BACK BUTTON HANDLER =====
  const backBtn = document.querySelector('.chat-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        const layout = document.querySelector('.chat-layout');
        if (layout) {
          layout.classList.remove('chat-view-active');
          layout.classList.add('list-view-active');
        }
      }
    });
  }

})();