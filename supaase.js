// ============================================================
// supabase-config.js
// Place this file in your project root.
// Include BEFORE any other page scripts that use Supabase.
// ============================================================

// ⚠️  REPLACE THESE WITH YOUR ACTUAL SUPABASE PROJECT VALUES
// Find them at: https://app.supabase.com → Settings → API
const SUPABASE_URL = 'https://wmesprxahyvpajhcnxsp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtZXNwcnhhaHl2cGFqaGNueHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTM0MjUsImV4cCI6MjA5NTgyOTQyNX0.3_y7qK4sv4LAMZgx-4yu5TJBcj_Q5_XfmAGqP1QFWBA';

// Initialize Supabase client (uses the CDN build loaded in HTML)
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ============================================================
// AUTH HELPERS - used across news.html, admin-dashboard.html
// ============================================================

/** Returns current session user or null */
async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

async function getUserProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
    if (error) {
        console.error('getUserProfile error:', error.message);
        return null;
    }
    return data;
}

/** Returns true if current user is admin */
async function isAdmin() {
    const user = await getCurrentUser();
    if (!user) return false;
    const profile = await getUserProfile(user.id);
    return profile?.role === 'admin';
}

/** Sign out and redirect to home */
async function signOut() {
    await supabase.auth.signOut();
    window.location.href = './index.html';
}

// ============================================================
// STORAGE HELPERS
// ============================================================
const NEWS_BUCKET = 'news-images';

/** Upload image file, returns public URL or null on error */
async function uploadNewsImage(file) {
    const ext = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = `posts/${fileName}`;

    const { error } = await supabase.storage
        .from(NEWS_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });

    if (error) {
        console.error('Image upload error:', error);
        return null;
    }

    const { data } = supabase.storage
        .from(NEWS_BUCKET)
        .getPublicUrl(filePath);

    return { url: data.publicUrl, path: filePath };
}

/** Delete image from storage by path */
async function deleteNewsImage(imagePath) {
    if (!imagePath) return;
    await supabase.storage
        .from(NEWS_BUCKET)
        .remove([imagePath]);
}

// ============================================================
// TOAST NOTIFICATION HELPER
// ============================================================
function showToast(message, type = 'success') {
    // Remove any existing toast
    const existing = document.getElementById('saq-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'saq-toast';
    toast.className = `saq-toast saq-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    // Auto-remove after 3.5s
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}