// admin.js — rewritten to match exact database schema
(function () {
    'use strict';

    let adminUser = null;
    let adminProfile = null;
    let allPosts = [];
    let allComments = [];
    let allUsers = [];
    let currentImageFile = null;

    const authGate = document.getElementById('admin-auth-gate');
    const adminApp = document.getElementById('admin-app');

    async function init() {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const profile = await getUserProfile(user.id);
            if (profile && profile.role === 'admin') {
                adminUser = user;
                adminProfile = profile;
                showApp();
                return;
            }
        }
        setupAuthGate();
    }

    function setupAuthGate() {
        const emailInput = document.getElementById('admin-email');
        const passInput  = document.getElementById('admin-password');
        const loginBtn   = document.getElementById('admin-login-btn');
        const errorEl    = document.getElementById('admin-login-error');

        async function doLogin() {
            const email    = emailInput.value.trim();
            const password = passInput.value;
            if (!email || !password) {
                errorEl.textContent = 'Please enter email and password.';
                errorEl.classList.add('visible');
                return;
            }
            loginBtn.disabled = true;
            loginBtn.textContent = 'Signing in…';
            errorEl.classList.remove('visible');

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign In';

            if (error) {
                errorEl.textContent = error.message || 'Sign in failed.';
                errorEl.classList.add('visible');
                return;
            }

            await new Promise(r => setTimeout(r, 600));
            const profile = await getUserProfile(data.user.id);

            if (!profile || profile.role !== 'admin') {
                await supabase.auth.signOut();
                errorEl.textContent = 'Access denied. Not an admin account.';
                errorEl.classList.add('visible');
                return;
            }

            adminUser = data.user;
            adminProfile = profile;
            showApp();
        }

        loginBtn.addEventListener('click', doLogin);
        passInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    }

    function showApp() {
        authGate.style.display = 'none';
        adminApp.classList.add('visible');

        const name = adminProfile?.full_name || adminProfile?.email || 'Admin';
        document.getElementById('admin-topbar-name').textContent = name;
        document.getElementById('admin-topbar-avatar').textContent = name[0].toUpperCase();

        setupNavigation();
        setupSignOut();
        setupMobileMenu();
        setupPostsPanel();
        document.addEventListener('click', handleDelegatedClicks);
        loadDashboard();
    }

    function handleDelegatedClicks(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        const extra  = btn.dataset.extra || '';
        if (action === 'edit-post')      editPost(id);
        if (action === 'delete-post')    deletePost(id, extra);
        if (action === 'delete-comment') deleteComment(id);
        if (action === 'ban-user')       banUser(id);
        if (action === 'unban-user')     unbanUser(id);
        if (action === 'promote-user')   promoteUser(id);
    }

    function setupNavigation() {
        document.querySelectorAll('.admin-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const panel = item.dataset.panel;
                document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`panel-${panel}`)?.classList.add('active');
                const titles = { dashboard: 'Dashboard', posts: 'News Posts', comments: 'Comments', users: 'Users' };
                document.getElementById('admin-topbar-title').textContent = titles[panel] || panel;
                document.getElementById('admin-sidebar').classList.remove('mobile-open');
                document.getElementById('sidebar-overlay').classList.remove('active');
                if (panel === 'posts'    && allPosts.length === 0)    loadPosts();
                if (panel === 'comments' && allComments.length === 0) loadComments();
                if (panel === 'users'    && allUsers.length === 0)    loadUsers();
            });
        });
    }

    function setupSignOut() {
        document.getElementById('admin-signout-btn').addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = './index.html';
        });
    }

    function setupMobileMenu() {
        const btn     = document.getElementById('admin-mobile-menu-btn');
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sidebar.classList.toggle('mobile-open');
            overlay.classList.toggle('active', isOpen);
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
        });
    }

    // ── Dashboard ──────────────────────────────────────────────────────────
    async function loadDashboard() {
        const [postsRes, usersRes, likesRes, commentsRes] = await Promise.all([
            supabase.from('news_posts').select('id', { count: 'exact', head: true }),
            supabase.from('profiles').select('id', { count: 'exact', head: true }),
            supabase.from('likes').select('id', { count: 'exact', head: true }),
            supabase.from('comments').select('id', { count: 'exact', head: true }).eq('is_deleted', false)
        ]);

        document.getElementById('stat-posts').textContent    = postsRes.count ?? '—';
        document.getElementById('stat-users').textContent    = usersRes.count ?? '—';
        document.getElementById('stat-likes').textContent    = likesRes.count ?? '—';
        document.getElementById('stat-comments').textContent = commentsRes.count ?? '—';
        document.getElementById('nav-posts-count').textContent    = postsRes.count ?? 0;
        document.getElementById('nav-users-count').textContent    = usersRes.count ?? 0;
        document.getElementById('nav-comments-count').textContent = commentsRes.count ?? 0;

        const { data: recent } = await supabase
            .from('news_posts')
            .select('id, title, published, created_at')
            .order('created_at', { ascending: false })
            .limit(5);

        const container = document.getElementById('dashboard-recent-posts');
        if (!recent || recent.length === 0) {
            container.innerHTML = `<div class="admin-empty"><p>No posts yet.</p></div>`;
            return;
        }
        container.innerHTML = recent.map(p => `
            <div class="admin-post-row" style="margin-bottom:0.7rem">
                <div class="admin-post-row-thumb-placeholder">📰</div>
                <div class="admin-post-row-info">
                    <div class="admin-post-row-title">${escHtml(p.title)}</div>
                    <div class="admin-post-row-meta"><span>${formatDate(p.created_at)}</span></div>
                </div>
                <span class="admin-status-badge ${p.published ? 'admin-status-badge--published' : 'admin-status-badge--draft'}">
                    ${p.published ? 'Published' : 'Draft'}
                </span>
            </div>
        `).join('');
    }

    // ── Posts Panel ────────────────────────────────────────────────────────
    function setupPostsPanel() {
        document.getElementById('toggle-post-form-btn').addEventListener('click', () => {
            const wrapper = document.getElementById('post-form-wrapper');
            if (!wrapper.classList.toggle('open')) resetPostForm();
        });
        document.getElementById('cancel-post-btn').addEventListener('click', () => {
            document.getElementById('post-form-wrapper').classList.remove('open');
            resetPostForm();
        });
        document.getElementById('save-post-btn').addEventListener('click', savePost);
        setupImageUpload();
        document.getElementById('posts-search').addEventListener('input', e => {
            renderPosts(filterPosts(allPosts, e.target.value));
        });
    }

    function setupImageUpload() {
        const input       = document.getElementById('post-image-input');
        const preview     = document.getElementById('image-preview');
        const removeBtn   = document.getElementById('image-remove-btn');
        const uploadArea  = document.getElementById('image-upload-area');
        const uploadLabel = document.getElementById('upload-label');

        input.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
            currentImageFile = file;
            const reader = new FileReader();
            reader.onload = ev => {
                preview.src = ev.target.result;
                preview.style.display = 'block';
                uploadLabel.style.display = 'none';
                removeBtn.style.display = 'flex';
                uploadArea.classList.add('has-image');
            };
            reader.readAsDataURL(file);
        });

        removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            currentImageFile = null;
            input.value = '';
            preview.src = '';
            preview.style.display = 'none';
            uploadLabel.style.display = '';
            removeBtn.style.display = 'none';
            uploadArea.classList.remove('has-image');
        });
    }

    async function loadPosts() {
        const container = document.getElementById('admin-posts-list');
        container.innerHTML = '<div class="admin-loading">Loading posts…</div>';

        const { data, error } = await supabase
            .from('news_posts_with_counts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            container.innerHTML = `<div class="admin-empty"><p>Error: ${escHtml(error.message)}</p></div>`;
            return;
        }
        allPosts = data || [];
        document.getElementById('nav-posts-count').textContent = allPosts.length;
        renderPosts(allPosts);
    }

    function filterPosts(posts, query) {
        if (!query.trim()) return posts;
        const q = query.toLowerCase();
        return posts.filter(p =>
            (p.title   || '').toLowerCase().includes(q) ||
            (p.caption || '').toLowerCase().includes(q)
        );
    }

    function renderPosts(posts) {
        const container = document.getElementById('admin-posts-list');
        if (posts.length === 0) {
            container.innerHTML = `<div class="admin-empty"><p>No posts found.</p></div>`;
            return;
        }
        container.innerHTML = posts.map(p => `
            <div class="admin-post-row" id="post-row-${p.id}">
                ${p.image_url
                    ? `<img class="admin-post-row-thumb" src="${escHtml(p.image_url)}" alt="" loading="lazy">`
                    : `<div class="admin-post-row-thumb-placeholder">📰</div>`}
                <div class="admin-post-row-info">
                    <div class="admin-post-row-title">${escHtml(p.title)}</div>
                    <div class="admin-post-row-meta">
                        <span>📅 ${formatDate(p.created_at)}</span>
                        <span>❤️ ${p.like_count || 0}</span>
                        <span>💬 ${p.comment_count || 0}</span>
                    </div>
                </div>
                <span class="admin-status-badge ${p.published ? 'admin-status-badge--published' : 'admin-status-badge--draft'}">
                    ${p.published ? 'Published' : 'Draft'}
                </span>
                <div class="admin-post-row-actions">
                    <button class="admin-btn admin-btn--sm" style="background:#f8f9fa;color:var(--navy);border-color:var(--border)"
                        data-action="edit-post" data-id="${p.id}">✏️ Edit</button>
                    <button class="admin-btn admin-btn--sm admin-btn--danger"
                        data-action="delete-post" data-id="${p.id}" data-extra="${escHtml(p.image_path || '')}">🗑️ Delete</button>
                </div>
            </div>
        `).join('');
    }

    async function savePost() {
        const title     = document.getElementById('post-title').value.trim();
        const content   = document.getElementById('post-content').value.trim();
        const published = document.getElementById('post-published').checked;
        const editingId = document.getElementById('editing-post-id').value;
        const existingImagePath = document.getElementById('editing-post-image-path').value;
        const btn = document.getElementById('save-post-btn');

        if (!title)   { showToast('Please enter a title.', 'error'); return; }
        if (!content) { showToast('Please enter content.', 'error'); return; }

        btn.disabled = true;
        btn.textContent = editingId ? 'Updating…' : 'Saving…';

        let imageUrl  = null;
        let imagePath = existingImagePath || null;

        if (currentImageFile) {
            const result = await uploadNewsImage(currentImageFile);
            if (!result) {
                showToast('Image upload failed.', 'error');
                btn.disabled = false;
                btn.textContent = 'Save Post';
                return;
            }
            imageUrl  = result.url;
            imagePath = result.path;
            if (editingId && existingImagePath) await deleteNewsImage(existingImagePath);
        } else if (editingId && existingImagePath) {
            const { data } = supabase.storage.from('news-images').getPublicUrl(existingImagePath);
            imageUrl  = data?.publicUrl;
            imagePath = existingImagePath;
        }

        const postData = {
            title,
            caption:   content,
            published: published,
            author_name: adminProfile?.full_name || adminProfile?.email || 'Admin',
            ...(imageUrl  && { image_url: imageUrl }),
            ...(imagePath && { image_path: imagePath })
        };

        let error;
        if (editingId) {
            ({ error } = await supabase.from('news_posts').update(postData).eq('id', editingId));
        } else {
            postData.author_id = adminUser.id;
            ({ error } = await supabase.from('news_posts').insert(postData));
        }

        btn.disabled = false;
        btn.textContent = 'Save Post';

        if (error) { showToast(`Error: ${error.message}`, 'error'); return; }

        showToast(editingId ? 'Post updated!' : 'Post created! 🎉', 'success');
        document.getElementById('post-form-wrapper').classList.remove('open');
        resetPostForm();
        allPosts = [];
        await loadPosts();
        loadDashboard();
    }

    function editPost(postId) {
        const post = allPosts.find(p => p.id === postId);
        if (!post) return;

        document.getElementById('post-form-wrapper').classList.add('open');
        document.getElementById('post-form-title').textContent = 'Edit Post';
        document.getElementById('editing-post-id').value = post.id;
        document.getElementById('editing-post-image-path').value = post.image_path || '';
        document.getElementById('post-title').value   = post.title;
        document.getElementById('post-content').value = post.caption || '';
        document.getElementById('post-published').checked = post.published;

        if (post.image_url) {
            document.getElementById('image-preview').src = post.image_url;
            document.getElementById('image-preview').style.display = 'block';
            document.getElementById('upload-label').style.display = 'none';
            document.getElementById('image-remove-btn').style.display = 'flex';
            document.getElementById('image-upload-area').classList.add('has-image');
        }
        document.getElementById('post-form-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function deletePost(postId, imagePath) {
        if (!confirm('Delete this post? This cannot be undone.')) return;
        const { error } = await supabase.from('news_posts').delete().eq('id', postId);
        if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
        if (imagePath) await deleteNewsImage(imagePath);
        showToast('Post deleted.', 'info');
        allPosts = allPosts.filter(p => p.id !== postId);
        renderPosts(allPosts);
        loadDashboard();
    }

    function resetPostForm() {
        document.getElementById('post-title').value   = '';
        document.getElementById('post-content').value = '';
        document.getElementById('post-published').checked = true;
        document.getElementById('editing-post-id').value = '';
        document.getElementById('editing-post-image-path').value = '';
        document.getElementById('post-form-title').textContent = 'Create New Post';
        currentImageFile = null;
        document.getElementById('image-preview').style.display = 'none';
        document.getElementById('image-preview').src = '';
        document.getElementById('post-image-input').value = '';
        document.getElementById('upload-label').style.display = '';
        document.getElementById('image-remove-btn').style.display = 'none';
        document.getElementById('image-upload-area').classList.remove('has-image');
    }

    // ── Comments Panel ─────────────────────────────────────────────────────
    async function loadComments() {
        const container = document.getElementById('admin-comments-list');

        const { data, error } = await supabase
            .from('comments')
            .select('*, news_posts(title)')
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            container.innerHTML = `<p style="color:red">Error: ${escHtml(error.message)}</p>`;
            return;
        }
        allComments = data || [];
        // Update the badge in sidebar
        document.getElementById('nav-comments-count').textContent = allComments.length;
        renderComments(allComments);

        document.getElementById('comments-search').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            renderComments(allComments.filter(c =>
                (c.content   || '').toLowerCase().includes(q) ||
                (c.user_name || '').toLowerCase().includes(q)
            ));
        });
    }

    function renderComments(comments) {
        const container = document.getElementById('admin-comments-list');
        if (comments.length === 0) {
            container.innerHTML = `<div class="admin-empty"><p>No comments found.</p></div>`;
            return;
        }
        container.innerHTML = comments.map(c => `
            <div class="admin-comment-row" id="admin-comment-${c.id}">
                <div class="admin-comment-row-header">
                    <div class="admin-comment-row-meta">
                        <strong>${escHtml(c.user_name || 'Anonymous')}</strong>
                        · ${formatDate(c.created_at)}
                    </div>
                    <button class="admin-btn admin-btn--sm admin-btn--danger"
                        data-action="delete-comment" data-id="${c.id}">🗑️ Delete</button>
                </div>
                <div class="admin-comment-row-text">${escHtml(c.content)}</div>
                <div class="admin-comment-row-post">On: "${escHtml(c.news_posts?.title || 'Unknown')}"</div>
            </div>
        `).join('');
    }

    async function deleteComment(commentId) {
        if (!confirm('Delete this comment?')) return;
        const { error } = await supabase
            .from('comments')
            .update({ is_deleted: true })
            .eq('id', commentId);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('Comment deleted.', 'info');
        const el = document.getElementById(`admin-comment-${commentId}`);
        if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
        allComments = allComments.filter(c => c.id !== commentId);
        // Update badge after deletion
        document.getElementById('nav-comments-count').textContent = allComments.length;
    }

    // ── Users Panel ────────────────────────────────────────────────────────
    async function loadUsers() {
        const tbody = document.getElementById('admin-users-table-body');
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center">Error: ${escHtml(error.message)}</td></tr>`;
            return;
        }
        allUsers = data || [];
        document.getElementById('nav-users-count').textContent = allUsers.length;
        renderUsers(allUsers);

        document.getElementById('users-search').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            renderUsers(allUsers.filter(u =>
                (u.full_name || '').toLowerCase().includes(q) ||
                (u.email     || '').toLowerCase().includes(q)
            ));
        });
    }

    function renderUsers(users) {
        const tbody = document.getElementById('admin-users-table-body');
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">No users found.</td></tr>`;
            return;
        }
        tbody.innerHTML = users.map(u => {
            const name    = u.full_name || u.email || 'Unknown';
            const initial = name[0].toUpperCase();
            return `
                <tr class="admin-user-row" id="user-row-${u.id}">
                    <td>
                        <div class="admin-user-info">
                            <div class="admin-user-avatar">${initial}</div>
                            <div>
                                <div style="font-weight:600;color:var(--navy)">${escHtml(name)}</div>
                                <div style="font-size:0.78rem;color:var(--muted)">${escHtml(u.email || '—')}</div>
                            </div>
                        </div>
                    </td>
                    <td data-label="Email" style="color:var(--muted);font-size:0.88rem">${escHtml(u.email || '—')}</td>
                    <td data-label="Role"><span class="admin-role-badge admin-role-badge--${u.role || 'user'}">${u.role || 'user'}</span></td>
                    <td data-label="Joined" style="color:var(--muted);font-size:0.88rem">${formatDate(u.created_at)}</td>
                    <td data-label="Status">${u.is_banned
                        ? `<span class="admin-banned-badge">Banned</span>`
                        : `<span style="color:var(--success);font-size:0.8rem;font-weight:600">Active</span>`}
                    </td>
                    <td class="user-td-actions">
                        ${u.role !== 'admin'
                            ? `<button class="admin-btn admin-btn--sm"
                                style="background:#f8f9fa;color:var(--navy);border-color:var(--border)"
                                data-action="promote-user" data-id="${u.id}">Make Admin</button>` : ''}
                        ${u.is_banned
                            ? `<button class="admin-btn admin-btn--sm admin-btn--success"
                                data-action="unban-user" data-id="${u.id}">Unban</button>`
                            : `<button class="admin-btn admin-btn--sm admin-btn--danger"
                                data-action="ban-user" data-id="${u.id}">Ban</button>`}
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function banUser(userId) {
        if (!confirm('Ban this user?')) return;
        const { error } = await supabase.from('profiles').update({ is_banned: true }).eq('id', userId);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('User banned.', 'info');
        allUsers = allUsers.map(u => u.id === userId ? { ...u, is_banned: true } : u);
        renderUsers(allUsers);
    }

    async function unbanUser(userId) {
        const { error } = await supabase.from('profiles').update({ is_banned: false }).eq('id', userId);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('User unbanned.', 'success');
        allUsers = allUsers.map(u => u.id === userId ? { ...u, is_banned: false } : u);
        renderUsers(allUsers);
    }

    async function promoteUser(userId) {
        if (!confirm('Promote this user to admin?')) return;
        const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('User promoted to admin.', 'success');
        allUsers = allUsers.map(u => u.id === userId ? { ...u, role: 'admin' } : u);
        renderUsers(allUsers);
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    function formatDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    init();
})();