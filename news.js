// news.js — News page logic
// Depends on: supaase.js loaded first

(function () {
    'use strict';

    let currentUser = null;
    let currentUserProfile = null;
    let userLikes = new Set();
    const PAGE_SIZE = 5;
    let currentPage = 0;
    let totalPosts = 0;

    const authBar        = document.getElementById('news-auth-bar');
    const postsFeed      = document.getElementById('news-posts-feed');
    const skeletons      = document.getElementById('news-skeletons');
    const postCount      = document.getElementById('news-post-count');
    const loadMoreBtn    = document.getElementById('news-load-more-btn');
    const authModal      = document.getElementById('news-auth-modal');
    const authModalClose = document.getElementById('news-auth-modal-close');
    const copiedToast    = document.getElementById('news-share-copied');

    // ── Init ────────────────────────────────────────────────────────────────
    async function init() {
        const { data: { user } } = await supabase.auth.getUser();
        currentUser = user;
        if (currentUser) {
            currentUserProfile = await getUserProfile(currentUser.id);
            await loadUserLikes();
        }
        renderAuthBar();
        await loadPosts(true);
        setupAuthModal();
        setupBackToTop();

       supabase.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
        currentUserProfile = await getUserProfile(currentUser.id);
        await loadUserLikes();
    } else {
        currentUserProfile = null;
        userLikes.clear();
    }
    renderAuthBar();

    // Update like buttons
    document.querySelectorAll('.news-like-btn').forEach(btn => {
        const postId = btn.dataset.postId;
        const liked  = userLikes.has(postId);
        btn.classList.toggle('liked', liked);
        const likeIcon = btn.querySelector('.like-icon');
        if (likeIcon) likeIcon.innerHTML = likedHeartSVG(liked);
    });

    // Replace "sign in to comment" prompts with actual comment forms
    if (currentUser) {
        document.querySelectorAll('.news-login-prompt').forEach(prompt => {
            const postId = prompt.closest('.news-comments-section')?.id?.replace('comments-', '');
            if (!postId) return;
            prompt.outerHTML = `
                <div class="news-comment-form">
                    <textarea class="news-comment-input" id="comment-input-${postId}"
                        placeholder="Write a comment…" rows="1" maxlength="1000"></textarea>
                    <button class="news-comment-submit" data-post-id="${postId}">Post</button>
                </div>
            `;
            // Bind the new submit button
            const section = document.getElementById(`comments-${postId}`);
            if (section) {
                const submitBtn = section.querySelector('.news-comment-submit');
                if (submitBtn) {
                    submitBtn.addEventListener('click', () => {
                        handleComment(postId, section.closest('.news-post-card'));
                    });
                }
                const textarea = section.querySelector(`#comment-input-${postId}`);
                if (textarea) {
                    textarea.addEventListener('input', () => {
                        textarea.style.height = 'auto';
                        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
                    });
                    textarea.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleComment(postId, section.closest('.news-post-card'));
                        }
                    });
                }
            }
        });
    } else {
        // Replace comment forms with sign in prompts when logged out
        document.querySelectorAll('.news-comment-form').forEach(form => {
            const postId = form.closest('.news-comments-section')?.id?.replace('comments-', '');
            if (!postId) return;
            form.outerHTML = `
                <div class="news-login-prompt">
                    <a id="comment-login-${postId}">Sign in</a> to leave a comment.
                </div>
            `;
            const loginLink = document.getElementById(`comment-login-${postId}`);
            if (loginLink) {
                loginLink.addEventListener('click', () => openAuthModal('login'));
            }
        });
    }
});
    }

    // ── Auth bar ─────────────────────────────────────────────────────────────
    function renderAuthBar() {
        if (!authBar) return;
        if (currentUser && currentUserProfile) {
            const name = currentUserProfile.full_name || currentUserProfile.email || 'User';
            authBar.innerHTML = `
                <span id="news-user-greeting">Welcome back, <strong>${escHtml(name)}</strong>! 🎉</span>
                <button class="news-auth-btn news-auth-btn--danger" id="news-signout-btn">Sign Out</button>
            `;
            document.getElementById('news-signout-btn').addEventListener('click', async () => {
                await supabase.auth.signOut();
                showToast('Signed out successfully', 'info');
            });
        } else {
            authBar.innerHTML = `
                <button class="news-auth-btn news-auth-btn--primary" id="news-signin-btn">Sign In</button>
                <button class="news-auth-btn news-auth-btn--secondary" id="news-signup-btn">Create Account</button>
            `;
            document.getElementById('news-signin-btn').addEventListener('click', () => openAuthModal('login'));
            document.getElementById('news-signup-btn').addEventListener('click', () => openAuthModal('signup'));
        }
    }

    // ── Load user likes ───────────────────────────────────────────────────────
    async function loadUserLikes() {
        if (!currentUser) return;
        const { data } = await supabase
            .from('likes')
            .select('post_id')
            .eq('user_id', currentUser.id);
        userLikes.clear();
        (data || []).forEach(l => userLikes.add(l.post_id));
    }

    // ── Load posts ────────────────────────────────────────────────────────────
    async function loadPosts(reset = false) {
        if (reset) {
            currentPage = 0;
            postsFeed.innerHTML = '';
        }

        const from = currentPage * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        // Uses your actual column name: published (not is_published)
        const { data: posts, error, count } = await supabase
            .from('news_posts_with_counts')
            .select('*', { count: 'exact' })
            .eq('published', true)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (skeletons) skeletons.style.display = 'none';

        if (error) {
            postsFeed.innerHTML = `
                <div class="news-empty-state">
                    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    <h3>Could not load posts</h3>
                    <p>${escHtml(error.message)}</p>
                </div>`;
            return;
        }

        if (count !== null) totalPosts = count;
        if (postCount) postCount.textContent = `${totalPosts} post${totalPosts !== 1 ? 's' : ''}`;

        if (!posts || posts.length === 0) {
            if (reset) {
                postsFeed.innerHTML = `
                    <div class="news-empty-state">
                        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
                        <h3>No posts yet</h3>
                        <p>Check back soon for the latest updates!</p>
                    </div>`;
            }
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }

        posts.forEach((post, index) => {
            const card = createPostCard(post, index);
            postsFeed.appendChild(card);
        });

        currentPage++;
        const loaded = currentPage * PAGE_SIZE;
        if (loadMoreBtn) loadMoreBtn.style.display = loaded < totalPosts ? 'block' : 'none';
    }

    // ── Build post card ───────────────────────────────────────────────────────
    function createPostCard(post, index) {
        const card = document.createElement('div');
        card.className = 'news-post-card';
        card.dataset.postId = post.id;
        card.style.animationDelay = `${index * 0.08}s`;

        const liked        = userLikes.has(post.id);
        // Use caption (your real column) with fallback to content
        const bodyText     = post.caption || post.content || '';
        const authorName   = post.author_name || post.author_full_name || 'Shadrack Akrofi-Quarcoo';
        const authorInitial = authorName[0].toUpperCase();
        const dateStr      = formatDate(post.created_at);
        const isLong       = bodyText.length > 280;

        card.innerHTML = `
            <div class="news-card-header">
                <div class="news-card-avatar">
                    ${post.author_avatar
                        ? `<img src="${escHtml(post.author_avatar)}" alt="${escHtml(authorInitial)}">`
                        : authorInitial}
                </div>
                <div class="news-card-author-info">
                    <div class="news-card-author-name">${escHtml(authorName)}</div>
                    <div class="news-card-timestamp">${dateStr}</div>
                </div>
            </div>

            ${post.image_url
                ? `<img class="news-card-image" src="${escHtml(post.image_url)}" alt="${escHtml(post.title)}" loading="lazy">`
                : ''}

            <div class="news-card-body">
                <h2 class="news-card-title">${escHtml(post.title)}</h2>
                <div class="news-card-content ${isLong ? 'truncated' : ''}" id="content-${post.id}">
                    ${escHtml(bodyText)}
                </div>
                ${isLong
                    ? `<button class="news-read-more" data-post-id="${post.id}" data-expanded="false">Read more</button>`
                    : ''}
            </div>

            <div class="news-card-actions">
                <button class="news-action-btn news-like-btn ${liked ? 'liked' : ''}"
                    data-post-id="${post.id}" aria-label="${liked ? 'Unlike' : 'Like'} this post">
                    <svg class="like-icon" viewBox="0 0 24 24">${likedHeartSVG(liked)}</svg>
                    <span class="like-count">${post.like_count || 0}</span>
                </button>
                <button class="news-action-btn news-action-btn--comment news-comment-toggle-btn"
                    data-post-id="${post.id}" aria-label="View comments">
                    <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
                    <span class="comment-count">${post.comment_count || 0}</span>
                </button>
                <div class="news-action-spacer"></div>
                <button class="news-action-btn news-action-btn--share news-share-btn"
                    data-post-url="${escHtml(window.location.href.split('?')[0])}?post=${post.id}"
                    aria-label="Share this post">
                    <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>
                    Share
                </button>
            </div>

            <div class="news-comments-section" id="comments-${post.id}">
                <div class="news-comments-list" id="comments-list-${post.id}">
                    <p style="color:#adb5bd;font-size:0.85rem;padding:0.5rem 0">Loading comments…</p>
                </div>
                ${currentUser
                    ? `<div class="news-comment-form">
                        <textarea class="news-comment-input" id="comment-input-${post.id}"
                            placeholder="Write a comment…" rows="1" maxlength="1000"></textarea>
                        <button class="news-comment-submit" data-post-id="${post.id}">Post</button>
                       </div>`
                    : `<div class="news-login-prompt">
                        <a id="comment-login-${post.id}">Sign in</a> to leave a comment.
                       </div>`
                }
            </div>
        `;

        // Read more toggle
        const readMoreBtn = card.querySelector('.news-read-more');
        if (readMoreBtn) {
            readMoreBtn.addEventListener('click', () => {
                const contentEl = card.querySelector(`#content-${post.id}`);
                const expanded  = readMoreBtn.dataset.expanded === 'true';
                contentEl.classList.toggle('truncated', expanded);
                readMoreBtn.textContent = expanded ? 'Read more' : 'Show less';
                readMoreBtn.dataset.expanded = !expanded;
            });
        }

        // Like button
        card.querySelector('.news-like-btn').addEventListener('click', () => {
            handleLike(post.id, card.querySelector('.news-like-btn'));
        });

        // Comment toggle
        const commentToggle   = card.querySelector('.news-comment-toggle-btn');
        const commentsSection = card.querySelector(`#comments-${post.id}`);
        commentToggle.addEventListener('click', () => {
            const isOpen = commentsSection.classList.toggle('open');
            if (isOpen) loadComments(post.id);
        });

        // Share
        card.querySelector('.news-share-btn').addEventListener('click', (e) => {
            handleShare(e.currentTarget.dataset.postUrl);
        });

        // Comment submit
        const submitBtn = card.querySelector('.news-comment-submit');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => handleComment(post.id, card));
        }

        // Login prompt
        const commentLoginLink = card.querySelector(`#comment-login-${post.id}`);
        if (commentLoginLink) {
            commentLoginLink.addEventListener('click', () => openAuthModal('login'));
        }

        // Auto-resize textarea
        const textarea = card.querySelector(`#comment-input-${post.id}`);
        if (textarea) {
            textarea.addEventListener('input', () => {
                textarea.style.height = 'auto';
                textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
            });
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleComment(post.id, card);
                }
            });
        }

        return card;
    }

    // ── Like / Unlike ─────────────────────────────────────────────────────────
    async function handleLike(postId, btn) {
        if (!currentUser) { openAuthModal('login'); return; }

        const isLiked    = userLikes.has(postId);
        const countEl    = btn.querySelector('.like-count');
        const currentCount = parseInt(countEl.textContent) || 0;

        if (isLiked) {
            userLikes.delete(postId);
            btn.classList.remove('liked');
            btn.querySelector('.like-icon').innerHTML = likedHeartSVG(false);
            countEl.textContent = Math.max(0, currentCount - 1);
            await supabase.from('likes').delete().match({ post_id: postId, user_id: currentUser.id });
        } else {
            userLikes.add(postId);
            btn.classList.add('liked');
            btn.querySelector('.like-icon').innerHTML = likedHeartSVG(true);
            countEl.textContent = currentCount + 1;
            await supabase.from('likes').insert({ post_id: postId, user_id: currentUser.id });
        }
    }

    // ── Load comments ─────────────────────────────────────────────────────────
    async function loadComments(postId) {
        const listEl = document.getElementById(`comments-list-${postId}`);
        if (!listEl) return;

        const { data: comments, error } = await supabase
            .from('comments')
            .select('*')
            .eq('post_id', postId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: true })
            .limit(50);

        if (error || !comments) {
            listEl.innerHTML = `<p style="color:#adb5bd;font-size:0.85rem">Could not load comments.</p>`;
            return;
        }

        if (comments.length === 0) {
            listEl.innerHTML = `<p style="color:#adb5bd;font-size:0.85rem;padding:0.5rem 0">No comments yet. Be the first!</p>`;
            return;
        }

        listEl.innerHTML = comments.map(c => renderComment(c)).join('');

        listEl.querySelectorAll('.news-comment-delete').forEach(btn => {
            btn.addEventListener('click', () => handleDeleteComment(btn.dataset.commentId, postId));
        });
    }

    function renderComment(comment) {
        // comments table uses user_name (text column) not a profiles join
        const name     = comment.user_name || 'Anonymous';
        const initial  = name[0].toUpperCase();
        const canDelete = currentUser && (
            currentUser.id === comment.user_id ||
            currentUserProfile?.role === 'admin'
        );

        return `
            <div class="news-comment-item" id="comment-item-${comment.id}">
                <div class="news-comment-avatar">${initial}</div>
                <div class="news-comment-bubble">
                    <div class="news-comment-author">${escHtml(name)}</div>
                    <div class="news-comment-text">${escHtml(comment.content)}</div>
                    <div class="news-comment-time">${formatDate(comment.created_at)}</div>
                </div>
                ${canDelete
                    ? `<button class="news-comment-delete" data-comment-id="${comment.id}" title="Delete">✕</button>`
                    : ''}
            </div>
        `;
    }

   

    // ── Delete comment ────────────────────────────────────────────────────────
    async function handleDeleteComment(commentId, postId) {
        if (!currentUser) return;
        if (!confirm('Delete this comment?')) return;

        const { error } = await supabase
            .from('comments')
            .update({ is_deleted: true })
            .eq('id', commentId);

        if (error) { showToast('Could not delete comment.', 'error'); return; }

        const item = document.getElementById(`comment-item-${commentId}`);
        if (item) {
            item.style.opacity   = '0';
            item.style.transform = 'translateX(-20px)';
            item.style.transition = 'all 0.3s ease';
            setTimeout(() => item.remove(), 300);
        }

        const card    = document.querySelector(`[data-post-id="${postId}"] .comment-count`);
        if (card) card.textContent = Math.max(0, parseInt(card.textContent) - 1);
    }

    // ── Share ─────────────────────────────────────────────────────────────────
    async function handleShare(url) {
        if (navigator.share) {
            try { await navigator.share({ title: 'Shadrack News', url }); return; } catch {}
        }
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        if (copiedToast) {
            copiedToast.classList.add('show');
            setTimeout(() => copiedToast.classList.remove('show'), 2500);
        }
    }

    // ── Auth Modal ────────────────────────────────────────────────────────────
    function setupAuthModal() {
        document.querySelectorAll('.news-auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.news-auth-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.news-auth-form').forEach(f => f.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`auth-form-${tab.dataset.tab}`).classList.add('active');
            });
        });

        if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);
        if (authModal) authModal.addEventListener('click', e => { if (e.target === authModal) closeAuthModal(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuthModal(); });

        document.getElementById('login-submit-btn').addEventListener('click', handleLogin);
        document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
        document.getElementById('signup-submit-btn').addEventListener('click', handleSignup);
        document.getElementById('signup-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleSignup(); });
    }

    function openAuthModal(tab = 'login') {
        if (!authModal) return;
        authModal.classList.add('open');
        document.body.style.overflow = 'hidden';
        document.querySelectorAll('.news-auth-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        document.querySelectorAll('.news-auth-form').forEach(f => {
            f.classList.toggle('active', f.id === `auth-form-${tab}`);
        });
    }

    function closeAuthModal() {
        if (!authModal) return;
        authModal.classList.remove('open');
        document.body.style.overflow = '';
        document.getElementById('login-error').classList.remove('visible');
        document.getElementById('signup-error').classList.remove('visible');
    }

    async function handleLogin() {
        const email    = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn      = document.getElementById('login-submit-btn');
        const errorEl  = document.getElementById('login-error');

        if (!email || !password) {
            errorEl.textContent = 'Please fill in all fields.';
            errorEl.classList.add('visible');
            return;
        }

        btn.disabled    = true;
        btn.textContent = 'Signing in…';
        errorEl.classList.remove('visible');

        const { error } = await supabase.auth.signInWithPassword({ email, password });

        btn.disabled    = false;
        btn.textContent = 'Sign In';

        if (error) {
            errorEl.textContent = error.message || 'Sign in failed.';
            errorEl.classList.add('visible');
        } else {
            closeAuthModal();
            showToast('Welcome back! 🎉', 'success');
        }
    }

    async function handleSignup() {
        const name     = document.getElementById('signup-name').value.trim();
        const email    = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const btn      = document.getElementById('signup-submit-btn');
        const errorEl  = document.getElementById('signup-error');

        if (!name || !email || !password) {
            errorEl.textContent = 'Please fill in all fields.';
            errorEl.classList.add('visible');
            return;
        }
        if (password.length < 6) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.add('visible');
            return;
        }

        btn.disabled    = true;
        btn.textContent = 'Creating account…';
        errorEl.classList.remove('visible');

        const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { 
        data: { full_name: name },
        emailRedirectTo: 'https://tsaqif-myga.com/news.html'
    }
});

        btn.disabled    = false;
        btn.textContent = 'Create Account';

        if (error) {
            errorEl.textContent = error.message || 'Sign up failed.';
            errorEl.classList.add('visible');
        } else {
            closeAuthModal();
            showToast('Account created!', 'success');
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function likedHeartSVG(liked) {
        return liked
            ? `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>`
            : `<path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>`;
    }

    function formatDate(iso) {
        const d    = new Date(iso);
        const now  = new Date();
        const diff = now - d;
        const min  = Math.floor(diff / 60000);
        const hr   = Math.floor(min / 60);
        const day  = Math.floor(hr / 24);
        if (min < 1)  return 'Just now';
        if (min < 60) return `${min}m ago`;
        if (hr  < 24) return `${hr}h ago`;
        if (day < 7)  return `${day}d ago`;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function setupBackToTop() {
        const btn = document.getElementById('olawaleBackToTopBtnElement');
        if (btn) btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // Load more button
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', async () => {
            loadMoreBtn.disabled    = true;
            loadMoreBtn.textContent = 'Loading…';
            await loadPosts(false);
            loadMoreBtn.disabled    = false;
            loadMoreBtn.textContent = 'Load More Posts';
        });
    }

    // Deep link to specific post via ?post=ID
    function checkDeepLink() {
        const params  = new URLSearchParams(window.location.search);
        const postId  = params.get('post');
        if (postId) {
            setTimeout(() => {
                const el = document.querySelector(`[data-post-id="${postId}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.boxShadow = '0 0 0 3px #f4b400';
                    setTimeout(() => el.style.boxShadow = '', 3000);
                }
            }, 800);
        }
    }

    async function handleComment(postId, card) {
    if (!currentUser) { openAuthModal('login'); return; }

    const textarea = document.getElementById(`comment-input-${postId}`);
    if (!textarea) return;

    const content = textarea.value.trim();
    if (!content) return;

    const submitBtn = card.querySelector('.news-comment-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Posting…'; }

    const userName = currentUserProfile?.full_name 
        || currentUserProfile?.email 
        || 'Anonymous';

    const { error } = await supabase.from('comments').insert({
        post_id:   postId,
        user_id:   currentUser.id,
        user_name: userName,
        content:   content
    });

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Post'; }

    if (error) {
        showToast('Could not post comment: ' + error.message, 'error');
        return;
    }

    textarea.value = '';
    textarea.style.height = 'auto';

    // Update comment count badge
    const countEl = document.querySelector(
        `[data-post-id="${postId}"] .comment-count`
    );
    if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;

    // Reload comments to show the new one
    await loadComments(postId);
    showToast('Comment posted! 💬', 'success');
}

    init().then(checkDeepLink);


})();