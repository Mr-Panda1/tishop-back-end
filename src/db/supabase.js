const env  = require('./env');
const supabaseClient = require('@supabase/supabase-js');

const supabase = supabaseClient.createClient(
    env.supabaseUrl,
    env.supabaseSecret
)

const supabaseAdmin = supabaseClient.createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey
)

module.exports = {
    supabase,
    supabaseAdmin,
};