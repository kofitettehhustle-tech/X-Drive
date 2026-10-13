const { createClient } = require('@supabase/supabase-js');

function getSupabaseConfig() {
    const url = (process.env.SUPABASE_URL || '').trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    return { url, serviceRoleKey };
}

function hasSupabaseConfig() {
    const { url, serviceRoleKey } = getSupabaseConfig();
    return Boolean(url && serviceRoleKey);
}

async function getSupabaseUserFromToken(authorizationHeader) {
    if (!hasSupabaseConfig()) return null;
    const match = typeof authorizationHeader === 'string'
        ? authorizationHeader.match(/^Bearer\s+(.+)$/i)
        : null;
    if (!match) return null;

    const { url, serviceRoleKey } = getSupabaseConfig();
    const supabase = createClient(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data?.user) return null;

    return {
        id: data.user.id,
        email: typeof data.user.email === 'string' ? data.user.email.trim().toLowerCase() : ''
    };
}

module.exports = {
    getSupabaseConfig,
    getSupabaseUserFromToken,
    hasSupabaseConfig
};
